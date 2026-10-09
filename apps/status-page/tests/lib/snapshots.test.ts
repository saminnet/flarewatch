import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { HubView } from '@flarewatch/shared';
import { forgetCachedView, readVisitorSnapshot } from '@/lib/snapshots';

const NOW = Date.parse('2026-06-10T12:00:00Z');
const view = (lastUpdate: number): HubView => ({
  lastUpdate,
  monitors: {},
  maintenances: [],
  announcements: [],
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  forgetCachedView();
});

afterEach(() => {
  forgetCachedView();
});

describe('visitor snapshots', () => {
  it('reuses the view before expiry and refreshes after twenty seconds', async () => {
    const fetch = vi.fn(async () => Response.json(view(200)));
    fetch.mockResolvedValueOnce(Response.json(view(100)));
    vi.stubGlobal('__env__', { MONITOR_WORKER: { fetch } });

    expect((await readVisitorSnapshot()).state?.lastUpdate).toBe(100);
    vi.setSystemTime(NOW + 19_999);
    expect((await readVisitorSnapshot()).state?.lastUpdate).toBe(100);
    vi.setSystemTime(NOW + 20_001);
    expect((await readVisitorSnapshot()).state?.lastUpdate).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('recovers immediately after a rejected view instead of caching the failure', async () => {
    const fetch = vi.fn(async () => Response.json(view(200)));
    fetch.mockRejectedValueOnce(new Error('Hub unavailable'));
    vi.stubGlobal('__env__', { MONITOR_WORKER: { fetch } });

    expect((await readVisitorSnapshot()).state).toBeNull();
    expect((await readVisitorSnapshot()).state?.lastUpdate).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps a newer cached view when an older request rejects', async () => {
    let rejectOld!: (error: Error) => void;
    const oldResponse = new Promise<Response>((_resolve, reject) => {
      rejectOld = reject;
    });
    const fetch = vi.fn(async () => Response.json(view(300)));
    fetch.mockReturnValueOnce(oldResponse);
    fetch.mockResolvedValueOnce(Response.json(view(200)));
    vi.stubGlobal('__env__', { MONITOR_WORKER: { fetch } });

    const oldSnapshot = readVisitorSnapshot();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    vi.setSystemTime(NOW + 20_001);
    expect((await readVisitorSnapshot()).state?.lastUpdate).toBe(200);
    rejectOld(new Error('Old request failed'));
    expect((await oldSnapshot).state).toBeNull();
    expect((await readVisitorSnapshot()).state?.lastUpdate).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries a failed initial check at sixty seconds but not before', async () => {
    let triggers = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/trigger')) {
        expect(init?.method).toBe('POST');
        if (++triggers === 1) throw new Error('Trigger unavailable');
        return new Response(null, { status: 202 });
      }
      return Response.json(view(0));
    });
    vi.stubGlobal('__env__', { MONITOR_WORKER: { fetch } });

    expect((await readVisitorSnapshot()).state?.lastUpdate).toBe(0);
    expect(triggers).toBe(1);
    vi.setSystemTime(NOW + 59_999);
    expect((await readVisitorSnapshot()).state?.lastUpdate).toBe(0);
    expect(triggers).toBe(1);
    vi.setSystemTime(NOW + 60_000);
    expect((await readVisitorSnapshot()).state?.lastUpdate).toBe(0);
    expect(triggers).toBe(2);
  });
});

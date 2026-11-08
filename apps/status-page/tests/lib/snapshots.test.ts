import { memoryKv } from '../helpers/kv';
import { createServerEntry } from '@tanstack/react-start/server';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { HubView } from '@flarewatch/shared';
import { readVisitorSnapshot } from '@/lib/hub-cache';
import { stubMonitorWorker } from '../helpers/bindings';
import { forgetViewAroundEachTest } from '../helpers/snapshots';

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
});
forgetViewAroundEachTest();

describe('visitor snapshots', () => {
  it('reuses the view before expiry and refreshes after twenty seconds', async () => {
    const fetch = vi.fn(async () => Response.json(view(200)));
    fetch.mockResolvedValueOnce(Response.json(view(100)));
    stubMonitorWorker(fetch);

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
    stubMonitorWorker(fetch);

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
    stubMonitorWorker(fetch);

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
    stubMonitorWorker(fetch);

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

const samples = [{ time: 1, ping: 10, loc: 'HEL' }];
const hubView = (lastUpdate = 100) => ({
  lastUpdate,
  monitors: {
    published: { status: 'up', incidents: [] },
    secret: { status: 'down', incidents: [] },
  },
  maintenances: [],
  announcements: [],
});

function memoryCache() {
  const entries = new Map<string, { response: Response; expires: number }>();
  return {
    match: vi.fn(async (key: string) => {
      const entry = entries.get(key);
      return entry && entry.expires > Date.now() ? entry.response.clone() : undefined;
    }),
    put: vi.fn(async (key: string, response: Response) => {
      const ttl = Number(response.headers.get('Cache-Control')?.split('=')[1]);
      entries.set(key, { response: response.clone(), expires: Date.now() + ttl * 1000 });
    }),
    delete: vi.fn(async (key: string) => entries.delete(key)),
    entries,
  };
}
async function isolate() {
  vi.resetModules();
  const { workerConfig } = await import('@flarewatch/config/worker');
  workerConfig.monitors = [
    { id: 'published', name: 'Website', method: 'GET', target: 'https://example.com' },
    {
      id: 'secret',
      name: 'Database',
      method: 'GET',
      target: 'https://private.example.com',
      private: true,
    },
  ];
  return { ...(await import('@/lib/hub-cache')), ...(await import('@/lib/snapshot-reads.server')) };
}
async function latency(read: (id: string) => Promise<unknown>, id: string) {
  const entry = createServerEntry({ fetch: async () => Response.json(await read(id)) });
  const response = await entry.fetch(new Request('https://status.test/'), {});
  return response.json();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv('DEV', false);
});

describe('location cache', () => {
  it('waits for older location writes before deleting after an edit', async () => {
    const cache = memoryCache();
    vi.stubGlobal('caches', { default: cache });
    let finishWrite!: () => void;
    const pending = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    cache.put.mockImplementationOnce(async (key, response) => {
      await pending;
      cache.entries.set(key, { response, expires: NOW + 40_000 });
    });
    let update = 100;
    stubMonitorWorker(async () => Response.json(hubView(update++)));
    const snapshots = await isolate();
    const old = snapshots.readVisitorSnapshot();
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledTimes(1));
    vi.setSystemTime(NOW + 20_001);
    await snapshots.readVisitorSnapshot();
    const invalidation = snapshots.forgetCachedView();
    finishWrite();
    await Promise.all([old, invalidation]);
    expect((await (await isolate()).readVisitorSnapshot()).state?.lastUpdate).toBe(102);
  });

  it('does not repopulate the location cache from a read started before an edit', async () => {
    const cache = memoryCache();
    vi.stubGlobal('caches', { default: cache });
    let resolveOld!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    const fetch = vi.fn(async () => Response.json(hubView(300)));
    fetch.mockReturnValueOnce(pending);
    fetch.mockResolvedValueOnce(Response.json(hubView(200)));
    stubMonitorWorker(fetch);
    const snapshots = await isolate();
    const old = snapshots.readVisitorSnapshot();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    vi.setSystemTime(NOW + 20_001);
    await snapshots.readVisitorSnapshot();
    await snapshots.forgetCachedView();
    resolveOld(Response.json(hubView(100)));
    await old;
    expect((await (await isolate()).readVisitorSnapshot()).state?.lastUpdate).toBe(300);
  });

  it('keeps no view read from the location cache while an edit deletes it', async () => {
    const cache = memoryCache();
    vi.stubGlobal('caches', { default: cache });
    let update = 100;
    stubMonitorWorker(async () => Response.json(hubView(update)));
    const snapshots = await isolate();
    await snapshots.readVisitorSnapshot();
    update = 200;
    let finishDelete!: () => void;
    const deleting = new Promise<void>((resolve) => {
      finishDelete = resolve;
    });
    cache.delete.mockImplementationOnce(async (key) => {
      await deleting;
      return cache.entries.delete(key);
    });
    const invalidation = snapshots.forgetCachedView();
    await vi.waitFor(() => expect(cache.delete).toHaveBeenCalledTimes(1));
    expect((await snapshots.readVisitorSnapshot()).state?.lastUpdate).toBe(100);
    finishDelete();
    await invalidation;
    expect((await snapshots.readVisitorSnapshot()).state?.lastUpdate).toBe(200);
  });

  it('shares only visitor data across isolates and expires the view after twenty seconds', async () => {
    const cache = memoryCache();
    vi.stubGlobal('caches', { default: cache });
    const fetch = vi.fn(async () => Response.json(hubView()));
    stubMonitorWorker(fetch);
    const first = await isolate();
    expect((await first.readVisitorSnapshot()).monitors.map(({ id }) => id)).toEqual(['published']);
    expect(await [...cache.entries.values()][0]!.response.clone().text()).not.toContain('secret');
    const second = await isolate();
    expect((await second.readVisitorSnapshot()).state?.monitors).toEqual({
      published: { status: 'up', incidents: [] },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 20_001);
    await second.readVisitorSnapshot();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect([...cache.entries.keys()]).toEqual(['https://flarewatch-cache.invalid/visitor-view']);
  });

  it('keeps operator and member reads fresh without reading or writing the location cache', async () => {
    const cache = memoryCache();
    vi.stubGlobal('caches', { default: cache });
    let update = 100;
    const fetch = vi.fn(async () => Response.json(hubView(update++)));
    stubMonitorWorker(fetch);
    const snapshots = await isolate();
    await snapshots.readVisitorSnapshot();
    vi.stubEnv('DEV', true);
    const entry = createServerEntry({
      fetch: async () => Response.json(await snapshots.readOperatorSnapshot()),
    });
    const first = await entry.fetch(new Request('https://status.test/'), {});
    expect(await first.json()).toMatchObject({
      state: { lastUpdate: 101, monitors: { secret: { status: 'down' } } },
    });
    const second = await entry.fetch(new Request('https://status.test/'), {});
    expect(await second.json()).toMatchObject({ state: { lastUpdate: 102 } });
    const { accessConfig } = await import('@flarewatch/config/access');
    accessConfig.providers = [
      {
        id: 'identity',
        name: 'Identity',
        issuer: 'https://identity.example.com',
        clientId: 'status',
      },
    ];
    accessConfig.members = ['member@example.com'];
    const { startSession } = await import('@/lib/operator.server');
    const kv = memoryKv();
    const session = await startSession(kv, null, {
      kind: 'provider',
      provider: 'identity',
      name: 'Member',
      email: 'member@example.com',
      emailVerified: true,
      groups: [],
    });
    stubMonitorWorker(fetch, { FLAREWATCH_STATE: kv });
    const memberEntry = createServerEntry({
      fetch: async () => Response.json(await snapshots.readMemberSnapshot()),
    });
    for (const lastUpdate of [103, 104]) {
      const response = await memberEntry.fetch(
        new Request('https://status.test/', {
          headers: { Cookie: `flarewatch_admin_session=${session}` },
        }),
        {},
      );
      expect(await response.json()).toMatchObject({
        state: { lastUpdate, monitors: { secret: { status: 'down' } } },
      });
    }
    expect(cache.match).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it('deletes the location view after an operator edit', async () => {
    const cache = memoryCache();
    vi.stubGlobal('caches', { default: cache });
    const fetch = vi.fn(async () => Response.json(hubView(200)));
    fetch.mockResolvedValueOnce(Response.json(hubView(100)));
    stubMonitorWorker(fetch);
    const snapshots = await isolate();
    await snapshots.readVisitorSnapshot();
    await snapshots.forgetCachedView();
    expect((await (await isolate()).readVisitorSnapshot()).state?.lastUpdate).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps private latency out of the location cache and checks access before a cache hit', async () => {
    const cache = memoryCache();
    vi.stubGlobal('caches', { default: cache });
    const fetch = vi.fn(async () => Response.json(samples));
    stubMonitorWorker(fetch);
    const snapshots = await isolate();
    vi.stubEnv('DEV', true);
    expect(await latency(snapshots.readMonitorLatency, 'secret')).toEqual(samples);
    expect(cache.entries.size).toBe(0);
    vi.stubEnv('DEV', false);
    expect(await latency(snapshots.readMonitorLatency, 'secret')).toEqual([]);
    expect(await latency(snapshots.readMonitorLatency, 'published')).toEqual(samples);
    const next = await isolate();
    expect(await latency(next.readMonitorLatency, 'secret')).toEqual([]);
    expect(await latency(next.readMonitorLatency, 'published')).toEqual(samples);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect([...cache.entries.keys()]).toEqual([
      'https://flarewatch-cache.invalid/latency/published',
    ]);
  });

  it('keeps the first deadline when another isolate copies a location cache hit', async () => {
    const cache = memoryCache();
    vi.stubGlobal('caches', { default: cache });
    const view = vi.fn(async () => Response.json(hubView()));
    const latencyCalls = vi.fn(async () => Response.json(samples));
    stubMonitorWorker(async (input) => (input.includes('/latency/') ? latencyCalls() : view()));
    await (await isolate()).readVisitorSnapshot();
    const first = await isolate();
    await latency(first.readMonitorLatency, 'published');
    vi.setSystemTime(NOW + 19_000);
    const second = await isolate();
    await second.readVisitorSnapshot();
    await latency(second.readMonitorLatency, 'published');
    expect(view).toHaveBeenCalledTimes(1);
    expect(latencyCalls).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 20_001);
    await second.readVisitorSnapshot();
    expect(view).toHaveBeenCalledTimes(2);
    vi.setSystemTime(NOW + 30_001);
    await latency(second.readMonitorLatency, 'published');
    expect(latencyCalls).toHaveBeenCalledTimes(2);
  });

  it('reuses latency for thirty seconds and retries a failed hub call immediately', async () => {
    const cache = memoryCache();
    vi.stubGlobal('caches', { default: cache });
    const fetch = vi.fn(async () => Response.json(samples));
    fetch.mockRejectedValueOnce(new Error('Hub unavailable'));
    stubMonitorWorker(fetch);
    const snapshots = await isolate();
    expect(await latency(snapshots.readMonitorLatency, 'published')).toEqual([]);
    expect(await latency(snapshots.readMonitorLatency, 'published')).toEqual(samples);
    vi.setSystemTime(NOW + 29_999);
    expect(await latency(snapshots.readMonitorLatency, 'published')).toEqual(samples);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.setSystemTime(NOW + 30_001);
    expect(await latency(snapshots.readMonitorLatency, 'published')).toEqual(samples);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('works when the location cache does nothing or throws', async () => {
    const cache = memoryCache();
    cache.match.mockRejectedValue(new Error('Cache unavailable'));
    cache.put.mockRejectedValue(new Error('Cache unavailable'));
    cache.delete.mockRejectedValue(new Error('Cache unavailable'));
    vi.stubGlobal('caches', { default: cache });
    stubMonitorWorker(async () => Response.json(hubView()));
    const snapshots = await isolate();
    expect((await snapshots.readVisitorSnapshot()).state?.lastUpdate).toBe(100);
    await snapshots.forgetCachedView();
    cache.match.mockResolvedValue(undefined);
    cache.put.mockResolvedValue(undefined);
    expect((await snapshots.readVisitorSnapshot()).state?.lastUpdate).toBe(100);
  });
});

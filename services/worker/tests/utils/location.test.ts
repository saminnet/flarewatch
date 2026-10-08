import { describe, expect, it, vi } from 'vite-plus/test';
import type { Fetcher } from '@flarewatch/shared';

describe('getEdgeLocation', () => {
  it('stops reading a trace answer that never ends', async () => {
    vi.resetModules();
    const { getEdgeLocation } = await import('../../src/utils/location');
    const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
    const fetcher = vi.fn<Fetcher>(
      async () => new Response(new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(chunk) })),
    );

    expect(await getEdgeLocation(fetcher)).toBe('UNKNOWN');
  });

  it('asks for the trace with a timeout and reads the data center', async () => {
    vi.resetModules();
    const { getEdgeLocation } = await import('../../src/utils/location');
    const fetcher = vi.fn<Fetcher>(async () => new Response('fl=1\ncolo=HEL\nip=1.2.3.4\n'));

    expect(await getEdgeLocation(fetcher)).toBe('HEL');
    expect(fetcher.mock.calls[0]?.[1]?.timeout).toBeGreaterThan(0);
  });

  it('asks again a minute after a failed lookup, and keeps a found one', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const { getEdgeLocation } = await import('../../src/utils/location');
    const fetcher = vi
      .fn<Fetcher>()
      .mockRejectedValueOnce(new Error('trace unavailable'))
      .mockResolvedValue(new Response('colo=HEL\n'));

    expect(await getEdgeLocation(fetcher)).toBe('ERROR');
    expect(await getEdgeLocation(fetcher)).toBe('ERROR');
    vi.advanceTimersByTime(60_000);
    expect(await getEdgeLocation(fetcher)).toBe('HEL');
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(await getEdgeLocation(fetcher)).toBe('HEL');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

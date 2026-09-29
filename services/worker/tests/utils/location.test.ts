import { describe, expect, it, vi } from 'vite-plus/test';
import type { Fetcher } from '@flarewatch/shared';
import { getEdgeLocation } from '../../src/utils/location';

describe('getEdgeLocation', () => {
  it('stops reading a trace answer that never ends', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
    const fetcher = vi.fn<Fetcher>(
      async () => new Response(new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(chunk) })),
    );

    expect(await getEdgeLocation(fetcher)).toBe('UNKNOWN');
  });

  it('asks for the trace with a timeout and reads the data center', async () => {
    const fetcher = vi.fn<Fetcher>(async () => new Response('fl=1\ncolo=HEL\nip=1.2.3.4\n'));

    expect(await getEdgeLocation(fetcher)).toBe('HEL');
    expect(fetcher.mock.calls[0]?.[1]?.timeout).toBeGreaterThan(0);
  });
});

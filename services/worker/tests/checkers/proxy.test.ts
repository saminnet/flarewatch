import { describe, it, expect, beforeEach, vi } from 'vite-plus/test';
import type { Fetcher, MonitorTarget } from '@flarewatch/shared';
import { checkExternalProxy } from '../../src/checkers/proxy';

const fetchMock = vi.fn<Fetcher>();

function createTarget(overrides: Partial<MonitorTarget> = {}): MonitorTarget {
  return {
    id: 'test-monitor',
    name: 'Test Monitor',
    method: 'GET',
    target: 'https://example.com',
    checkProxy: 'https://proxy.example.com/check',
    ...overrides,
  };
}

describe('checkExternalProxy', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('returns a failure when the proxy URL is not configured', async () => {
    const target = createTarget();
    delete target.checkProxy;

    const result = await checkExternalProxy(target, undefined, fetchMock);

    expect(result).toEqual({
      location: 'ERROR',
      result: { ok: false, error: 'Proxy URL is not configured' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the monitor with authorization and its configured timeout', async () => {
    const proxyResult = {
      location: 'FRA',
      result: { ok: true, latency: 42 },
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(proxyResult), { status: 200 }));
    const target = createTarget({ timeout: 1234 });

    const result = await checkExternalProxy(
      target,
      { FLAREWATCH_PROXY_TOKEN: 'test-token' },
      fetchMock,
    );

    expect(result).toEqual(proxyResult);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://proxy.example.com/check');
    expect(options).toEqual({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
      body: JSON.stringify(target),
      timeout: 1234,
    });
  });

  it('uses the default timeout and omits authorization without a token', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ location: 'FRA', result: { ok: false, error: 'Connection refused' } }),
        { status: 200 },
      ),
    );

    const result = await checkExternalProxy(createTarget(), undefined, fetchMock);

    expect(result).toEqual({
      location: 'FRA',
      result: { ok: false, error: 'Connection refused' },
    });
    const [, options] = fetchMock.mock.calls[0] ?? [];
    expect(options?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(options?.timeout).toBe(10000);
  });

  it('returns the proxy status and a truncated response body for non-2xx responses', async () => {
    const body = 'x'.repeat(220);
    fetchMock.mockResolvedValue(new Response(body, { status: 503 }));

    const result = await checkExternalProxy(createTarget(), undefined, fetchMock);

    expect(result).toEqual({
      location: 'ERROR',
      result: { ok: false, error: `Proxy HTTP 503: ${'x'.repeat(200)}` },
    });
  });

  it.each([
    null,
    {},
    { location: 'FRA' },
    { location: 'FRA', result: { ok: true } },
    { location: 'FRA', result: { ok: false } },
    { location: 'FRA', result: { ok: false, error: 'failed', latency: 'slow' } },
    { location: 'FRA', result: { ok: 'yes', latency: 1 } },
  ])('rejects an invalid proxy response %#', async (proxyResult) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(proxyResult), { status: 200 }));

    const result = await checkExternalProxy(createTarget(), undefined, fetchMock);

    expect(result).toEqual({
      location: 'ERROR',
      result: { ok: false, error: 'Proxy returned invalid response' },
    });
  });

  it('accepts a failed proxy result with numeric latency', async () => {
    const proxyResult = {
      location: 'LHR',
      result: { ok: false, error: 'Timed out', latency: 10000 },
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(proxyResult), { status: 200 }));

    const result = await checkExternalProxy(createTarget(), undefined, fetchMock);

    expect(result).toEqual(proxyResult);
  });

  it('returns a failure when the proxy request throws', async () => {
    fetchMock.mockRejectedValue(new Error('network unavailable'));

    const result = await checkExternalProxy(createTarget(), undefined, fetchMock);

    expect(result).toEqual({
      location: 'ERROR',
      result: { ok: false, error: 'Proxy error: network unavailable' },
    });
  });
});

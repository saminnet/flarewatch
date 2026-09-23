import { describe, it, expect, beforeEach, vi } from 'vite-plus/test';
import type { Fetcher, MonitorTarget } from '@flarewatch/shared';
import { checkMonitor } from '../../src/checkers';
import type { CheckDeps } from '../../src/checkers/deps';

const getEdgeLocationMock = vi.fn<() => Promise<string>>();
const fetchMock = vi.fn<Fetcher>();
const httpCheckMock = vi.fn<CheckDeps['http']['check']>();
const tcpCheckMock = vi.fn<CheckDeps['tcp']['check']>();
const globalPingCheckMock = vi.fn<CheckDeps['globalPing']['check']>();

const deps: CheckDeps = {
  http: { check: httpCheckMock },
  tcp: { check: tcpCheckMock },
  globalPing: { check: globalPingCheckMock },
  getEdgeLocation: getEdgeLocationMock,
  fetcher: fetchMock,
};

function createTarget(overrides: Partial<MonitorTarget> = {}): MonitorTarget {
  return {
    id: 'test-monitor',
    name: 'Test Monitor',
    method: 'GET',
    target: 'https://example.com',
    ...overrides,
  };
}

describe('checkMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEdgeLocationMock.mockResolvedValue('SFO');
  });

  it('delegates to GlobalPing when checkProxy is globalping://', async () => {
    globalPingCheckMock.mockResolvedValue({
      location: 'LON',
      result: { ok: true, latency: 1 },
    });

    const result = await checkMonitor(
      createTarget({ checkProxy: 'globalping://TOKEN' }),
      undefined,
      deps,
    );

    expect(result).toEqual({ location: 'LON', result: { ok: true, latency: 1 } });
    expect(globalPingCheckMock).toHaveBeenCalledTimes(1);
    expect(getEdgeLocationMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an error for worker:// proxy and includes edge location', async () => {
    const result = await checkMonitor(
      createTarget({ checkProxy: 'worker://local' }),
      undefined,
      deps,
    );

    expect(result.location).toBe('SFO');
    expect(result.result.ok).toBe(false);
    if (result.result.ok) throw new Error('Expected failure');
    expect(result.result.error).toBe('worker:// checkProxy is not supported');
    expect(getEdgeLocationMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses external proxy with Authorization when FLAREWATCH_PROXY_TOKEN is set', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ location: 'FRA', result: { ok: true, latency: 42 } }), {
        status: 200,
      }),
    );

    const target = createTarget({ checkProxy: 'https://proxy.example.com/check', timeout: 1234 });

    const result = await checkMonitor(target, { FLAREWATCH_PROXY_TOKEN: 'test-token' }, deps);

    expect(result).toEqual({ location: 'FRA', result: { ok: true, latency: 42 } });
    expect(getEdgeLocationMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://proxy.example.com/check');
    expect(options?.method).toBe('POST');
    expect(options?.timeout).toBe(1234);
    expect(options?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    });
    expect(JSON.parse(options?.body as string)).toEqual(target);
  });

  it('does not send Authorization when no proxy token is set', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ location: 'FRA', result: { ok: true, latency: 42 } }), {
        status: 200,
      }),
    );

    await checkMonitor(
      createTarget({ checkProxy: 'https://proxy.example.com/check' }),
      undefined,
      deps,
    );

    const [, options] = fetchMock.mock.calls[0] ?? [];
    expect(options?.headers).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('returns a failure when proxy returns non-2xx', async () => {
    fetchMock.mockResolvedValue(new Response('bad', { status: 500 }));

    const result = await checkMonitor(
      createTarget({ checkProxy: 'https://proxy.example.com' }),
      undefined,
      deps,
    );

    expect(result.location).toBe('ERROR');
    expect(result.result.ok).toBe(false);
    if (result.result.ok) throw new Error('Expected failure');
    expect(result.result.error).toBe('Proxy HTTP 500: bad');
  });

  it('returns a failure when proxy returns invalid JSON shape', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await checkMonitor(
      createTarget({ checkProxy: 'https://proxy.example.com' }),
      undefined,
      deps,
    );

    expect(result.location).toBe('ERROR');
    expect(result.result.ok).toBe(false);
    if (result.result.ok) throw new Error('Expected failure');
    expect(result.result.error).toBe('Proxy returned invalid response');
  });

  it('returns a failure when proxy result payload is invalid', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ location: 'FRA', result: { ok: true } }), { status: 200 }),
    );

    const result = await checkMonitor(
      createTarget({ checkProxy: 'https://proxy.example.com' }),
      undefined,
      deps,
    );

    expect(result.location).toBe('ERROR');
    expect(result.result.ok).toBe(false);
    if (result.result.ok) throw new Error('Expected failure');
    expect(result.result.error).toBe('Proxy returned invalid response');
  });

  it('returns a failure when proxy request throws', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));

    const result = await checkMonitor(
      createTarget({ checkProxy: 'https://proxy.example.com' }),
      undefined,
      deps,
    );

    expect(result.location).toBe('ERROR');
    expect(result.result.ok).toBe(false);
    if (result.result.ok) throw new Error('Expected failure');
    expect(result.result.error).toBe('Proxy error: boom');
    expect(getEdgeLocationMock).not.toHaveBeenCalled();
    expect(httpCheckMock).not.toHaveBeenCalled();
  });

  it('falls back to direct HTTP check when proxy fails and fallback is enabled', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    httpCheckMock.mockResolvedValue({ ok: true, latency: 9 });

    const result = await checkMonitor(
      createTarget({
        checkProxy: 'https://proxy.example.com',
        checkProxyFallback: true,
      }),
      undefined,
      deps,
    );

    expect(result).toEqual({ location: 'SFO', result: { ok: true, latency: 9 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getEdgeLocationMock).toHaveBeenCalledTimes(1);
    expect(httpCheckMock).toHaveBeenCalledTimes(1);
  });

  it('does not fall back when the external proxy succeeds and fallback is enabled', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ location: 'FRA', result: { ok: true, latency: 21 } }), {
        status: 200,
      }),
    );

    const result = await checkMonitor(
      createTarget({ checkProxy: 'https://proxy.example.com/check', checkProxyFallback: true }),
      undefined,
      deps,
    );

    expect(result).toEqual({ location: 'FRA', result: { ok: true, latency: 21 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(httpCheckMock).not.toHaveBeenCalled();
    expect(getEdgeLocationMock).not.toHaveBeenCalled();
  });

  it('does not fall back when GlobalPing fails and fallback is disabled', async () => {
    globalPingCheckMock.mockResolvedValue({
      location: 'LON',
      result: { ok: false, error: 'GlobalPing failed' },
    });

    const result = await checkMonitor(
      createTarget({ checkProxy: 'globalping://TOKEN' }),
      undefined,
      deps,
    );

    expect(result).toEqual({ location: 'LON', result: { ok: false, error: 'GlobalPing failed' } });
    expect(globalPingCheckMock).toHaveBeenCalledTimes(1);
    expect(getEdgeLocationMock).not.toHaveBeenCalled();
    expect(httpCheckMock).not.toHaveBeenCalled();
  });

  it('falls back to direct check when GlobalPing fails and fallback is enabled', async () => {
    globalPingCheckMock.mockResolvedValue({
      location: 'LON',
      result: { ok: false, error: 'GlobalPing failed' },
    });
    httpCheckMock.mockResolvedValue({ ok: true, latency: 7 });

    const result = await checkMonitor(
      createTarget({
        checkProxy: 'globalping://TOKEN',
        checkProxyFallback: true,
      }),
      undefined,
      deps,
    );

    expect(result).toEqual({ location: 'SFO', result: { ok: true, latency: 7 } });
    expect(globalPingCheckMock).toHaveBeenCalledTimes(1);
    expect(getEdgeLocationMock).toHaveBeenCalledTimes(1);
    expect(httpCheckMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to direct check for worker:// proxy when fallback is enabled', async () => {
    httpCheckMock.mockResolvedValue({ ok: true, latency: 11 });

    const result = await checkMonitor(
      createTarget({
        checkProxy: 'worker://local',
        checkProxyFallback: true,
      }),
      undefined,
      deps,
    );

    expect(result).toEqual({ location: 'SFO', result: { ok: true, latency: 11 } });
    expect(getEdgeLocationMock).toHaveBeenCalledTimes(1);
    expect(httpCheckMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('delegates to TCP checker when method is TCP_PING', async () => {
    tcpCheckMock.mockResolvedValue({ ok: true, latency: 5 });

    const result = await checkMonitor(
      createTarget({ method: 'TCP_PING', target: 'example.com:80' }),
      undefined,
      deps,
    );

    expect(result).toEqual({ location: 'SFO', result: { ok: true, latency: 5 } });
    expect(getEdgeLocationMock).toHaveBeenCalledTimes(1);
    expect(tcpCheckMock).toHaveBeenCalledTimes(1);
    expect(httpCheckMock).not.toHaveBeenCalled();
  });

  it('delegates to HTTP checker for non-TCP monitors', async () => {
    httpCheckMock.mockResolvedValue({ ok: false, error: 'bad', latency: 1 });

    const result = await checkMonitor(createTarget(), undefined, deps);

    expect(result).toEqual({ location: 'SFO', result: { ok: false, error: 'bad', latency: 1 } });
    expect(getEdgeLocationMock).toHaveBeenCalledTimes(1);
    expect(httpCheckMock).toHaveBeenCalledTimes(1);
    expect(tcpCheckMock).not.toHaveBeenCalled();
  });
});

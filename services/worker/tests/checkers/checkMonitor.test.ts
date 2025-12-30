import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MonitorTarget } from '@flarewatch/shared';

const getEdgeLocationMock = vi.fn<() => Promise<string>>();
const fetchWithTimeoutMock = vi.fn();
const httpCheckMock = vi.fn();
const tcpCheckMock = vi.fn();
const globalPingCheckMock = vi.fn();

vi.mock('../../src/utils/location', () => ({
  getEdgeLocation: getEdgeLocationMock,
}));

vi.mock('@flarewatch/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@flarewatch/shared')>();
  return {
    ...actual,
    fetchWithTimeout: fetchWithTimeoutMock,
  };
});

vi.mock('../../src/checkers/http', () => ({
  httpChecker: { check: httpCheckMock },
}));

vi.mock('../../src/checkers/tcp', () => ({
  tcpChecker: { check: tcpCheckMock },
}));

vi.mock('../../src/checkers/globalping', () => ({
  globalPingChecker: { check: globalPingCheckMock },
}));

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

    const { checkMonitor } = await import('../../src/checkers');
    const result = await checkMonitor(createTarget({ checkProxy: 'globalping://TOKEN' }));

    expect(result).toEqual({ location: 'LON', result: { ok: true, latency: 1 } });
    expect(globalPingCheckMock).toHaveBeenCalledTimes(1);
    expect(getEdgeLocationMock).not.toHaveBeenCalled();
    expect(fetchWithTimeoutMock).not.toHaveBeenCalled();
  });

  it('returns an error for worker:// proxy and includes edge location', async () => {
    const { checkMonitor } = await import('../../src/checkers');
    const result = await checkMonitor(createTarget({ checkProxy: 'worker://local' }));

    expect(result.location).toBe('SFO');
    expect(result.result.ok).toBe(false);
    if (result.result.ok) throw new Error('Expected failure');
    expect(result.result.error).toBe('worker:// checkProxy is not supported');
    expect(getEdgeLocationMock).toHaveBeenCalledTimes(1);
    expect(fetchWithTimeoutMock).not.toHaveBeenCalled();
  });

  it('uses external proxy with Authorization when FLAREWATCH_PROXY_TOKEN is set', async () => {
    fetchWithTimeoutMock.mockResolvedValue(
      new Response(JSON.stringify({ location: 'FRA', result: { ok: true, latency: 42 } }), {
        status: 200,
      }),
    );

    const target = createTarget({ checkProxy: 'https://proxy.example.com/check', timeout: 1234 });

    const { checkMonitor } = await import('../../src/checkers');
    const result = await checkMonitor(target, { FLAREWATCH_PROXY_TOKEN: 'test-token' });

    expect(result).toEqual({ location: 'FRA', result: { ok: true, latency: 42 } });
    expect(getEdgeLocationMock).not.toHaveBeenCalled();
    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchWithTimeoutMock.mock.calls[0] ?? [];
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
    fetchWithTimeoutMock.mockResolvedValue(
      new Response(JSON.stringify({ location: 'FRA', result: { ok: true, latency: 42 } }), {
        status: 200,
      }),
    );

    const { checkMonitor } = await import('../../src/checkers');
    await checkMonitor(createTarget({ checkProxy: 'https://proxy.example.com/check' }));

    const [, options] = fetchWithTimeoutMock.mock.calls[0] ?? [];
    expect(options?.headers).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('returns a failure when proxy returns non-2xx', async () => {
    fetchWithTimeoutMock.mockResolvedValue(new Response('bad', { status: 500 }));

    const { checkMonitor } = await import('../../src/checkers');
    const result = await checkMonitor(createTarget({ checkProxy: 'https://proxy.example.com' }));

    expect(result.location).toBe('ERROR');
    expect(result.result.ok).toBe(false);
    if (result.result.ok) throw new Error('Expected failure');
    expect(result.result.error).toBe('Proxy HTTP 500: bad');
  });

  it('returns a failure when proxy returns invalid JSON shape', async () => {
    fetchWithTimeoutMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const { checkMonitor } = await import('../../src/checkers');
    const result = await checkMonitor(createTarget({ checkProxy: 'https://proxy.example.com' }));

    expect(result.location).toBe('ERROR');
    expect(result.result.ok).toBe(false);
    if (result.result.ok) throw new Error('Expected failure');
    expect(result.result.error).toBe('Proxy returned invalid response');
  });

  it('returns a failure when proxy request throws', async () => {
    fetchWithTimeoutMock.mockRejectedValue(new Error('boom'));

    const { checkMonitor } = await import('../../src/checkers');
    const result = await checkMonitor(createTarget({ checkProxy: 'https://proxy.example.com' }));

    expect(result.location).toBe('ERROR');
    expect(result.result.ok).toBe(false);
    if (result.result.ok) throw new Error('Expected failure');
    expect(result.result.error).toBe('Proxy error: boom');
  });

  it('delegates to TCP checker when method is TCP_PING', async () => {
    tcpCheckMock.mockResolvedValue({ ok: true, latency: 5 });

    const { checkMonitor } = await import('../../src/checkers');
    const result = await checkMonitor(
      createTarget({ method: 'TCP_PING', target: 'example.com:80' }),
    );

    expect(result).toEqual({ location: 'SFO', result: { ok: true, latency: 5 } });
    expect(getEdgeLocationMock).toHaveBeenCalledTimes(1);
    expect(tcpCheckMock).toHaveBeenCalledTimes(1);
    expect(httpCheckMock).not.toHaveBeenCalled();
  });

  it('delegates to HTTP checker for non-TCP monitors', async () => {
    httpCheckMock.mockResolvedValue({ ok: false, error: 'bad', latency: 1 });

    const { checkMonitor } = await import('../../src/checkers');
    const result = await checkMonitor(createTarget());

    expect(result).toEqual({ location: 'SFO', result: { ok: false, error: 'bad', latency: 1 } });
    expect(getEdgeLocationMock).toHaveBeenCalledTimes(1);
    expect(httpCheckMock).toHaveBeenCalledTimes(1);
    expect(tcpCheckMock).not.toHaveBeenCalled();
  });
});

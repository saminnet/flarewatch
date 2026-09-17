import { describe, it, expect, beforeEach, vi } from 'vite-plus/test';
import type { Fetcher, MonitorTarget } from '@flarewatch/shared';
import { checkDirectMonitor } from '../../src/checkers/direct';
import type { CheckDeps } from '../../src/checkers/deps';

const getEdgeLocationMock = vi.fn<() => Promise<string>>();
const httpCheckMock = vi.fn<CheckDeps['http']['check']>();
const tcpCheckMock = vi.fn<CheckDeps['tcp']['check']>();
const globalPingCheckMock = vi.fn<CheckDeps['globalPing']['check']>();

const deps: CheckDeps = {
  http: { check: httpCheckMock },
  tcp: { check: tcpCheckMock },
  globalPing: { check: globalPingCheckMock },
  getEdgeLocation: getEdgeLocationMock,
  fetcher: vi.fn<Fetcher>(),
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

describe('checkDirectMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEdgeLocationMock.mockResolvedValue('SFO');
  });

  it('runs TCP_PING monitors through the TCP checker', async () => {
    const target = createTarget({ method: 'TCP_PING', target: 'example.com:443' });
    tcpCheckMock.mockResolvedValue({ ok: true, latency: 5 });

    const result = await checkDirectMonitor(target, deps);

    expect(result).toEqual({ location: 'SFO', result: { ok: true, latency: 5 } });
    expect(getEdgeLocationMock).toHaveBeenCalledTimes(1);
    expect(tcpCheckMock).toHaveBeenCalledWith(target);
    expect(httpCheckMock).not.toHaveBeenCalled();
  });

  it('runs non-TCP monitors through the HTTP checker', async () => {
    const target = createTarget({ method: 'POST' });
    httpCheckMock.mockResolvedValue({ ok: false, error: 'Service unavailable', latency: 8 });

    const result = await checkDirectMonitor(target, deps);

    expect(result).toEqual({
      location: 'SFO',
      result: { ok: false, error: 'Service unavailable', latency: 8 },
    });
    expect(getEdgeLocationMock).toHaveBeenCalledTimes(1);
    expect(httpCheckMock).toHaveBeenCalledWith(target);
    expect(tcpCheckMock).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach, vi } from 'vite-plus/test';
import type { MonitorTarget } from '@flarewatch/shared';

const getEdgeLocationMock = vi.fn<() => Promise<string>>();
const httpCheckMock = vi.fn();
const tcpCheckMock = vi.fn();

vi.mock('../../src/utils/location', () => ({
  getEdgeLocation: getEdgeLocationMock,
}));

vi.mock('../../src/checkers/http', () => ({
  httpChecker: { check: httpCheckMock },
}));

vi.mock('../../src/checkers/tcp', () => ({
  tcpChecker: { check: tcpCheckMock },
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

describe('checkDirectMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEdgeLocationMock.mockResolvedValue('SFO');
  });

  it('runs TCP_PING monitors through the TCP checker', async () => {
    const target = createTarget({ method: 'TCP_PING', target: 'example.com:443' });
    tcpCheckMock.mockResolvedValue({ ok: true, latency: 5 });

    const { checkDirectMonitor } = await import('../../src/checkers/direct');
    const result = await checkDirectMonitor(target);

    expect(result).toEqual({ location: 'SFO', result: { ok: true, latency: 5 } });
    expect(getEdgeLocationMock).toHaveBeenCalledTimes(1);
    expect(tcpCheckMock).toHaveBeenCalledWith(target);
    expect(httpCheckMock).not.toHaveBeenCalled();
  });

  it('runs non-TCP monitors through the HTTP checker', async () => {
    const target = createTarget({ method: 'POST' });
    httpCheckMock.mockResolvedValue({ ok: false, error: 'Service unavailable', latency: 8 });

    const { checkDirectMonitor } = await import('../../src/checkers/direct');
    const result = await checkDirectMonitor(target);

    expect(result).toEqual({
      location: 'SFO',
      result: { ok: false, error: 'Service unavailable', latency: 8 },
    });
    expect(getEdgeLocationMock).toHaveBeenCalledTimes(1);
    expect(httpCheckMock).toHaveBeenCalledWith(target);
    expect(tcpCheckMock).not.toHaveBeenCalled();
  });
});

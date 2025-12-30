import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MonitorTarget } from '@flarewatch/shared';

const fetchWithTimeoutMock = vi.fn();
const checkSSLCertificateMock = vi.fn();

vi.mock('@flarewatch/shared', async () => {
  const actual = await vi.importActual<typeof import('@flarewatch/shared')>('@flarewatch/shared');
  return {
    ...actual,
    fetchWithTimeout: fetchWithTimeoutMock,
  };
});

vi.mock('../../src/checkers/ssl', () => ({
  checkSSLCertificate: checkSSLCertificateMock,
}));

function createMonitor(overrides: Partial<MonitorTarget> = {}): MonitorTarget {
  return {
    id: 'test-monitor',
    name: 'Test Monitor',
    method: 'GET',
    target: 'https://example.com',
    ...overrides,
  };
}

describe('checkHttp (proxy)', () => {
  beforeEach(() => {
    fetchWithTimeoutMock.mockReset();
    checkSSLCertificateMock.mockReset();
  });

  it('fails when sslCheckEnabled is true and SSL check fails', async () => {
    fetchWithTimeoutMock.mockResolvedValue(new Response('ok', { status: 200 }));
    checkSSLCertificateMock.mockRejectedValue(new Error('tls unavailable'));

    const { checkHttp } = await import('../../src/checkers/http');

    const result = await checkHttp(createMonitor({ sslCheckEnabled: true }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failure');
    expect(result.error).toContain('SSL check failed');
  });
});

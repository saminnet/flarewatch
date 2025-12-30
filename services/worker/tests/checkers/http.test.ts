import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MonitorTarget } from '@flarewatch/shared';

const fetchWithTimeoutMock = vi.fn();

vi.mock('@flarewatch/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@flarewatch/shared')>();
  return {
    ...actual,
    fetchWithTimeout: fetchWithTimeoutMock,
  };
});

function createMonitor(overrides: Partial<MonitorTarget> = {}): MonitorTarget {
  return {
    id: 'test-monitor',
    name: 'Test Monitor',
    method: 'GET',
    target: 'https://example.com',
    ...overrides,
  };
}

describe('HttpChecker', () => {
  beforeEach(() => {
    fetchWithTimeoutMock.mockReset();
  });

  it('adds user-agent header when missing', async () => {
    fetchWithTimeoutMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const { HttpChecker } = await import('../../src/checkers/http');
    const checker = new HttpChecker();

    const result = await checker.check(createMonitor({ headers: { 'X-Test': '1' } }));

    expect(result.ok).toBe(true);
    expect(fetchWithTimeoutMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchWithTimeoutMock.mock.calls[0] ?? [];
    expect(options).toBeDefined();
    if (!options) throw new Error('Expected fetch options to be defined');

    const headers = options.headers as Headers;
    expect(headers.get('user-agent')).toMatch(/FlareWatch\/1\.0/);
    expect(headers.get('x-test')).toBe('1');
  });

  it('does not override existing user-agent header', async () => {
    fetchWithTimeoutMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const { HttpChecker } = await import('../../src/checkers/http');
    const checker = new HttpChecker();

    const result = await checker.check(createMonitor({ headers: { 'User-Agent': 'custom' } }));

    expect(result.ok).toBe(true);
    const [, options] = fetchWithTimeoutMock.mock.calls[0] ?? [];
    const headers = (options?.headers ?? new Headers()) as Headers;
    expect(headers.get('user-agent')).toBe('custom');
  });

  it('fails on non-2xx status when expectedCodes is not set', async () => {
    fetchWithTimeoutMock.mockResolvedValue(new Response('fail', { status: 500 }));

    const { HttpChecker } = await import('../../src/checkers/http');
    const checker = new HttpChecker();

    const result = await checker.check(createMonitor());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failure');
    expect(result.error).toBe('Expected 2xx status, got 500');
  });

  it('accepts non-2xx status when expectedCodes includes it', async () => {
    fetchWithTimeoutMock.mockResolvedValue(new Response('not found', { status: 404 }));

    const { HttpChecker } = await import('../../src/checkers/http');
    const checker = new HttpChecker();

    const result = await checker.check(createMonitor({ expectedCodes: [404] }));

    expect(result.ok).toBe(true);
  });

  it('fails when expectedCodes does not include the response status', async () => {
    fetchWithTimeoutMock.mockResolvedValue(new Response('not found', { status: 404 }));

    const { HttpChecker } = await import('../../src/checkers/http');
    const checker = new HttpChecker();

    const result = await checker.check(createMonitor({ expectedCodes: [200] }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failure');
    expect(result.error).toBe('Expected status 200, got 404');
  });

  it('fails when required responseKeyword is missing', async () => {
    fetchWithTimeoutMock.mockResolvedValue(new Response('hello', { status: 200 }));

    const { HttpChecker } = await import('../../src/checkers/http');
    const checker = new HttpChecker();

    const result = await checker.check(createMonitor({ responseKeyword: 'world' }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failure');
    expect(result.error).toBe('Required keyword "world" not found in response');
  });

  it('fails when forbidden keyword is present', async () => {
    fetchWithTimeoutMock.mockResolvedValue(new Response('contains secret', { status: 200 }));

    const { HttpChecker } = await import('../../src/checkers/http');
    const checker = new HttpChecker();

    const result = await checker.check(createMonitor({ responseForbiddenKeyword: 'secret' }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failure');
    expect(result.error).toBe('Forbidden keyword "secret" found in response');
  });

  it('maps timeout-like errors to a consistent message using the configured timeout', async () => {
    fetchWithTimeoutMock.mockRejectedValue(new Error('timeout'));

    const { HttpChecker } = await import('../../src/checkers/http');
    const checker = new HttpChecker();

    const result = await checker.check(createMonitor({ timeout: 1234 }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failure');
    expect(result.error).toBe('Timeout after 1234ms');
    expect(result.latency).toBeTypeOf('number');
  });
});

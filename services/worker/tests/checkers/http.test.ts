import { describe, it, expect, beforeEach, vi } from 'vite-plus/test';
import type { Fetcher, MonitorTarget } from '@flarewatch/shared';
import { HttpChecker } from '../../src/checkers/http';

const fetchMock = vi.fn<Fetcher>();
const checker = new HttpChecker(fetchMock);

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
    fetchMock.mockReset();
  });

  it('adds user-agent header when missing', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const result = await checker.check(createMonitor({ headers: { 'X-Test': '1' } }));

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] ?? [];
    expect(options).toBeDefined();
    if (!options) throw new Error('Expected fetch options to be defined');

    const headers = options.headers as Headers;
    expect(headers.get('user-agent')).toMatch(/FlareWatch\/1\.0/);
    expect(headers.get('x-test')).toBe('1');
  });

  it('does not override existing user-agent header', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    const result = await checker.check(createMonitor({ headers: { 'User-Agent': 'custom' } }));

    expect(result.ok).toBe(true);
    const [, options] = fetchMock.mock.calls[0] ?? [];
    const headers = (options?.headers ?? new Headers()) as Headers;
    expect(headers.get('user-agent')).toBe('custom');
  });

  it('fails on non-2xx status when expectedCodes is not set', async () => {
    fetchMock.mockResolvedValue(new Response('fail', { status: 500 }));

    const result = await checker.check(createMonitor());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failure');
    expect(result.error).toBe('Expected 2xx status, got 500');
  });

  it('accepts non-2xx status when expectedCodes includes it', async () => {
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }));

    const result = await checker.check(createMonitor({ expectedCodes: [404] }));

    expect(result.ok).toBe(true);
  });

  it('fails when expectedCodes does not include the response status', async () => {
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }));

    const result = await checker.check(createMonitor({ expectedCodes: [200] }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failure');
    expect(result.error).toBe('Expected status 200, got 404');
  });

  it('fails when required responseKeyword is missing', async () => {
    fetchMock.mockResolvedValue(new Response('hello', { status: 200 }));

    const result = await checker.check(createMonitor({ responseKeyword: 'world' }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failure');
    expect(result.error).toBe('Required keyword "world" not found in response');
  });

  it('fails when forbidden keyword is present', async () => {
    fetchMock.mockResolvedValue(new Response('contains secret', { status: 200 }));

    const result = await checker.check(createMonitor({ responseForbiddenKeyword: 'secret' }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failure');
    expect(result.error).toBe('Forbidden keyword "secret" found in response');
  });

  it('checks response headers and a JSON value', async () => {
    const monitor = createMonitor({
      responseHeaderEquals: { 'content-type': 'application/json' },
      responseJsonPath: '$.checks[0].ok',
      responseJsonValue: true,
    });
    const reply = (ok: boolean) =>
      new Response(JSON.stringify({ checks: [{ ok }] }), {
        headers: { 'Content-Type': 'application/json' },
      });

    fetchMock.mockResolvedValueOnce(reply(true));
    expect((await checker.check(monitor)).ok).toBe(true);

    fetchMock.mockResolvedValueOnce(reply(false));
    const result = await checker.check(monitor);
    expect(result).toMatchObject({ ok: false, error: 'JSON value at $.checks[0].ok is not true' });
  });

  it('shows a connection failure the runtime does not explain as "Connection failed"', async () => {
    fetchMock.mockRejectedValue(new Error('internal error; reference = af8u8m9eap4vgpst8jm117i3'));

    const result = await checker.check(createMonitor());

    expect(result).toMatchObject({ ok: false, error: 'Connection failed' });
  });

  it('maps timeout-like errors to a consistent message using the configured timeout', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));

    const result = await checker.check(createMonitor({ timeout: 1234 }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failure');
    expect(result.error).toBe('Timeout after 1234ms');
    expect(result.latency).toBeTypeOf('number');
  });
});

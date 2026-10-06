import { describe, it, expect, beforeEach, vi } from 'vite-plus/test';
import type { Fetcher, MonitorTarget } from '@flarewatch/shared';
import { checkExternalProxy } from '../../src/checkers/proxy';

const fetchMock = vi.fn<Fetcher>();
const PROXY_URL = 'https://proxy.example.com/check';

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

  it('posts the monitor with authorization and its configured timeout', async () => {
    const proxyResult = {
      location: 'FRA',
      result: { ok: true, latency: 42 },
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(proxyResult), { status: 200 }));
    const target = createTarget({ timeout: 1234 });

    const result = await checkExternalProxy(
      target,
      PROXY_URL,
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
      body: JSON.stringify({
        id: 'test-monitor',
        name: 'Test Monitor',
        method: 'GET',
        target: 'https://example.com',
        timeout: 1234,
      }),
      timeout: 1234,
    });
  });

  it('never sends the proxy a Globalping token', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ location: 'FRA', result: { ok: true, latency: 1 } })),
    );

    await checkExternalProxy(
      createTarget({ checkProxy: 'globalping://TOKEN-1234', confirmVia: PROXY_URL }),
      PROXY_URL,
      undefined,
      fetchMock,
    );

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeTypeOf('string');
    expect(fetchMock.mock.calls[0]?.[1]?.body).not.toContain('TOKEN-1234');
  });

  it('uses the default timeout and omits authorization without a token', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ location: 'FRA', result: { ok: false, error: 'Connection refused' } }),
        { status: 200 },
      ),
    );

    const result = await checkExternalProxy(createTarget(), PROXY_URL, undefined, fetchMock);

    expect(result).toEqual({
      location: 'FRA',
      result: { ok: false, error: 'Connection refused' },
    });
    const [, options] = fetchMock.mock.calls[0] ?? [];
    expect(options?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(options?.timeout).toBe(10000);
  });

  it('stops reading a proxy answer that never ends', async () => {
    const chunk = new TextEncoder().encode(' '.repeat(64 * 1024));
    fetchMock.mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(chunk) })),
    );

    const result = await checkExternalProxy(createTarget(), PROXY_URL, undefined, fetchMock);

    expect(result.location).toBe('ERROR');
    expect(result.result.ok).toBe(false);
    expect(JSON.stringify(result.result)).toContain('over 1048576 bytes');
  });

  it('stops reading a proxy error answer that never ends', async () => {
    const chunk = new TextEncoder().encode(' '.repeat(64 * 1024));
    fetchMock.mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(chunk) }), {
        status: 503,
      }),
    );

    const result = await checkExternalProxy(createTarget(), PROXY_URL, undefined, fetchMock);

    expect(result).toEqual({ location: 'ERROR', result: { ok: false, error: 'Proxy HTTP 503' } });
  });

  it('keeps the proxy response body out of the public error', async () => {
    fetchMock.mockResolvedValue(
      new Response('Authorization: Bearer proxy-secret', { status: 503 }),
    );

    const result = await checkExternalProxy(createTarget(), PROXY_URL, undefined, fetchMock);

    expect(result).toEqual({
      location: 'ERROR',
      result: { ok: false, error: 'Proxy HTTP 503' },
    });
  });

  it('keeps the proxy token out of the logs when the proxy echoes it', async () => {
    fetchMock.mockResolvedValue(
      new Response('Authorization: Bearer proxy-secret', { status: 503 }),
    );
    const logged: unknown[] = [];
    const spies = (['info', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((line: unknown) => logged.push(line)),
    );

    await checkExternalProxy(
      createTarget(),
      PROXY_URL,
      { FLAREWATCH_PROXY_TOKEN: 'proxy-secret' },
      fetchMock,
    );
    for (const spy of spies) spy.mockRestore();

    expect(JSON.stringify(logged)).toContain('Bearer <proxy token>');
    expect(JSON.stringify(logged)).not.toContain('proxy-secret');
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

    const result = await checkExternalProxy(createTarget(), PROXY_URL, undefined, fetchMock);

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

    const result = await checkExternalProxy(createTarget(), PROXY_URL, undefined, fetchMock);

    expect(result).toEqual(proxyResult);
  });

  it('rejects a proxy result whose latency is not a finite, non-negative number', async () => {
    for (const body of [
      '{"location":"FRA","result":{"ok":true,"latency":1e400}}',
      '{"location":"FRA","result":{"ok":true,"latency":-1}}',
      '{"location":"FRA","result":{"ok":false,"error":"slow","latency":1e400}}',
    ]) {
      fetchMock.mockResolvedValue(new Response(body, { status: 200 }));

      const result = await checkExternalProxy(createTarget(), PROXY_URL, undefined, fetchMock);

      expect(result).toEqual({
        location: 'ERROR',
        result: { ok: false, error: 'Proxy returned invalid response' },
      });
    }
  });

  it('keeps the proxy token out of a failed result the proxy reports', async () => {
    const proxyResult = {
      location: 'LHR',
      result: { ok: false, error: 'upstream refused Bearer proxy-secret', latency: 12 },
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(proxyResult), { status: 200 }));

    const result = await checkExternalProxy(
      createTarget(),
      PROXY_URL,
      { FLAREWATCH_PROXY_TOKEN: 'proxy-secret' },
      fetchMock,
    );

    expect(result).toEqual({
      location: 'LHR',
      result: { ok: false, error: 'upstream refused Bearer <proxy token>', latency: 12 },
    });
  });

  describe('header and JSON checks', () => {
    const TOO_OLD = {
      location: 'ERROR',
      result: {
        ok: false,
        error: 'Proxy is too old for header and JSON checks: update to flarewatch-proxy 2.0.0',
      },
    };
    const assertions: [string, Partial<MonitorTarget>][] = [
      ['a header check', { responseHeaderEquals: { 'X-A': '1' } }],
      ['a JSON check', { responseJsonPath: '$.status', responseJsonValue: 'ok' }],
    ];
    const answer = (fields: { contract?: unknown }) =>
      new Response(
        JSON.stringify({ location: 'FRA', result: { ok: true, latency: 5 }, ...fields }),
      );

    it.each(assertions)('fails %s on a proxy that sends no contract', async (_case, overrides) => {
      fetchMock.mockResolvedValue(answer({}));

      const result = await checkExternalProxy(
        createTarget(overrides),
        PROXY_URL,
        undefined,
        fetchMock,
      );

      expect(result).toEqual(TOO_OLD);
    });

    it.each([1, 0, '2', 2.5, null])('treats contract %j as no contract', async (contract) => {
      fetchMock.mockResolvedValue(answer({ contract }));

      const result = await checkExternalProxy(
        createTarget({ responseHeaderEquals: { 'X-A': '1' } }),
        PROXY_URL,
        undefined,
        fetchMock,
      );

      expect(result).toEqual(TOO_OLD);
    });

    it('fails on an old proxy even when the proxy reports a failure', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ location: 'FRA', result: { ok: false, error: 'Refused', latency: 3 } }),
        ),
      );

      const result = await checkExternalProxy(
        createTarget({ responseJsonPath: '$.ok', responseJsonValue: true }),
        PROXY_URL,
        undefined,
        fetchMock,
      );

      expect(result).toEqual(TOO_OLD);
    });

    it.each([2, 3])('takes the result of a proxy with contract %j', async (contract) => {
      fetchMock.mockResolvedValue(answer({ contract }));

      const result = await checkExternalProxy(
        createTarget({ responseHeaderEquals: { 'X-A': '1' } }),
        PROXY_URL,
        undefined,
        fetchMock,
      );

      expect(result).toEqual({ location: 'FRA', result: { ok: true, latency: 5 } });
    });

    it('reports the failure a proxy with contract 2 finds', async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({
            contract: 2,
            location: 'FRA',
            result: { ok: false, error: 'Header X-A is not 1', latency: 5 },
          }),
        ),
      );

      const result = await checkExternalProxy(
        createTarget({ responseHeaderEquals: { 'X-A': '1' } }),
        PROXY_URL,
        undefined,
        fetchMock,
      );

      expect(result).toEqual({
        location: 'FRA',
        result: { ok: false, error: 'Header X-A is not 1', latency: 5 },
      });
    });

    it('runs a monitor without them on a proxy that sends no contract', async () => {
      fetchMock.mockResolvedValue(answer({}));

      const result = await checkExternalProxy(
        createTarget({ responseKeyword: 'ok', expectedCodes: [200] }),
        PROXY_URL,
        undefined,
        fetchMock,
      );

      expect(result).toEqual({ location: 'FRA', result: { ok: true, latency: 5 } });
    });
  });

  it('returns a failure when the proxy request throws', async () => {
    fetchMock.mockRejectedValue(new Error('network unavailable'));

    const result = await checkExternalProxy(createTarget(), PROXY_URL, undefined, fetchMock);

    expect(result).toEqual({
      location: 'ERROR',
      result: { ok: false, error: 'Proxy error: network unavailable' },
    });
  });
});

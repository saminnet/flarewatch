import { getEdgeLocation as locateEdge } from '../../src/utils/location';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vite-plus/test';
import type { CheckContext, Fetcher, MonitorTarget, VpcBinding } from '@flarewatch/shared';
import { checkMonitor, planIssues, runBudget } from '../../src/checkers';
import type { CheckDeps } from '../../src/checkers/deps';
import { HttpChecker } from '../../src/checkers/http';
import { TcpChecker } from '../../src/checkers/tcp';
import { GlobalPingChecker } from '../../src/checkers/globalping';

const GLOBALPING_API = 'https://api.globalping.io/v1/measurements';

type Socket = { opened: Promise<unknown>; close: () => Promise<void> };
const getEdgeLocation = () => locateEdge(async () => new Response('colo=SFO\n'));
const fetchMock = vi.fn<Fetcher>();
const connectMock = vi.fn<(address: { hostname: string; port: number }) => Promise<Socket>>();

const deps: CheckDeps = {
  http: new HttpChecker(fetchMock),
  tcp: new TcpChecker(connectMock),
  globalPing: new GlobalPingChecker(fetchMock),
  getEdgeLocation,
  fetcher: fetchMock,
};

const urls = () => fetchMock.mock.calls.map(([url]) => String(url));

function createCtx(budget: Partial<CheckContext['budget']> = {}): CheckContext {
  return { env: {}, budget: { deadline: Date.now() + 55_000, subrequests: 10, ...budget } };
}

function createTarget(overrides: Partial<MonitorTarget> = {}): MonitorTarget {
  return {
    id: 'test-monitor',
    name: 'Test Monitor',
    method: 'GET',
    target: 'https://example.com',
    ...overrides,
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const inProgress = () => json({ status: 'in-progress', results: [] });
const finishedAt = (country: string, city: string, total: number) =>
  json({
    status: 'finished',
    results: [
      {
        probe: { country, city },
        result: { status: 'finished', statusCode: 200, rawBody: 'ok', timings: { total } },
      },
    ],
  });
const failedMeasurement = (output: string) =>
  json({
    status: 'finished',
    results: [
      { probe: { country: 'DE', city: 'Berlin' }, result: { status: 'failed', rawOutput: output } },
    ],
  });

describe('checkMonitor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('delegates to GlobalPing when checkProxy is globalping://', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 'm1' }, 202))
      .mockResolvedValueOnce(finishedAt('DE', 'Berlin', 5));

    const result = await checkMonitor(
      createTarget({ checkProxy: 'globalping://TOKEN' }),
      createCtx(),
      deps,
    );

    expect(result).toEqual({ location: 'DE/Berlin', result: { ok: true, latency: 5 } });
    expect(urls()).toEqual([GLOBALPING_API, `${GLOBALPING_API}/m1`]);
    const [, options] = fetchMock.mock.calls[0] ?? [];
    expect(options?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer TOKEN',
    });
    expect(JSON.parse(typeof options?.body === 'string' ? options.body : '')).toMatchObject({
      type: 'http',
      target: 'example.com',
    });
  });

  it('uses external proxy with Authorization when FLAREWATCH_PROXY_TOKEN is set', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ location: 'FRA', result: { ok: true, latency: 42 } }), {
        status: 200,
      }),
    );

    const target = createTarget({ checkProxy: 'https://proxy.example.com/check', timeout: 1234 });

    const result = await checkMonitor(
      target,
      { ...createCtx(), env: { FLAREWATCH_PROXY_TOKEN: 'test-token' } },
      deps,
    );

    expect(result).toEqual({ location: 'FRA', result: { ok: true, latency: 42 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://proxy.example.com/check');
    expect(options?.method).toBe('POST');
    expect(options?.timeout).toBe(1234);
    expect(options?.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    });
    const { checkProxy: _checkProxy, ...monitor } = target;
    expect(JSON.parse(options?.body as string)).toEqual(monitor);
  });

  it('falls back to direct when the proxy fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(new Response('ok'));

    const result = await checkMonitor(
      createTarget({
        checkProxy: 'https://proxy.example.com',
        checkProxyFallback: true,
      }),
      createCtx(),
      deps,
    );

    expect(result.location).toBe('SFO');
    expect(result.result.ok).toBe(true);
    expect(urls()).toEqual(['https://proxy.example.com', 'https://example.com']);
  });

  it('skips the fallback when the proxy succeeds', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ location: 'FRA', result: { ok: true, latency: 21 } }), {
        status: 200,
      }),
    );

    const result = await checkMonitor(
      createTarget({ checkProxy: 'https://proxy.example.com/check', checkProxyFallback: true }),
      createCtx(),
      deps,
    );

    expect(result).toEqual({ location: 'FRA', result: { ok: true, latency: 21 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fall back when GlobalPing fails and fallback is disabled', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 'm1' }, 202))
      .mockResolvedValueOnce(failedMeasurement('probe offline'));

    const result = await checkMonitor(
      createTarget({ checkProxy: 'globalping://TOKEN' }),
      createCtx(),
      deps,
    );

    expect(result).toEqual({
      location: 'ERROR',
      result: { ok: false, error: 'GlobalPing: Measurement failed: probe offline' },
    });
    expect(urls()).toEqual([GLOBALPING_API, `${GLOBALPING_API}/m1`]);
  });

  it('falls back to direct check when GlobalPing fails and fallback is enabled', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 'm1' }, 202))
      .mockResolvedValueOnce(failedMeasurement('probe offline'))
      .mockResolvedValueOnce(new Response('ok'));

    const result = await checkMonitor(
      createTarget({
        checkProxy: 'globalping://TOKEN',
        checkProxyFallback: true,
      }),
      createCtx(),
      deps,
    );

    expect(result.location).toBe('SFO');
    expect(result.result.ok).toBe(true);
    expect(urls()).toEqual([GLOBALPING_API, `${GLOBALPING_API}/m1`, 'https://example.com']);
  });

  it('checks a TCP_PING by opening a socket to the target', async () => {
    connectMock.mockResolvedValue({ opened: Promise.resolve({}), close: async () => {} });

    const result = await checkMonitor(
      createTarget({ method: 'TCP_PING', target: 'example.com:80' }),
      createCtx(),
      deps,
    );

    expect(result).toMatchObject({ location: 'SFO', result: { ok: true } });
    expect(connectMock).toHaveBeenCalledWith({ hostname: 'example.com', port: 80 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks an HTTP monitor by requesting its target', async () => {
    fetchMock.mockResolvedValue(new Response('ok'));

    const result = await checkMonitor(createTarget({ method: 'POST' }), createCtx(), deps);

    expect(result).toMatchObject({ location: 'SFO', result: { ok: true } });
    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://example.com');
    expect(options?.method).toBe('POST');
    expect(options?.redirect).toBe('manual');
  });

  it('returns a located failure instead of throwing when a checker crashes', async () => {
    const ctx = createCtx();
    const clock = vi.spyOn(Date, 'now').mockImplementationOnce(() => {
      throw new Error('Check crashed');
    });
    const result = await checkMonitor(createTarget(), ctx, deps);
    clock.mockRestore();

    expect(result).toEqual({
      location: 'SFO',
      result: { ok: false, error: 'Check failed: Error: Check crashed' },
    });
  });

  describe('VPC', () => {
    const socket = (): Socket => ({ opened: Promise.resolve({}), close: async () => {} });

    function vpcCtx(binding: VpcBinding): CheckContext {
      return { ...createCtx(), env: { VPC: binding } };
    }

    it('fails with setup advice when the VPC binding is absent', async () => {
      const result = await checkMonitor(createTarget({ checkProxy: 'vpc' }), createCtx(), deps);

      expect(result).toEqual({
        location: 'ERROR',
        result: {
          ok: false,
          error:
            'The VPC binding is missing: add [[vpc_networks]] to services/worker/wrangler.toml',
        },
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(connectMock).not.toHaveBeenCalled();
    });

    it('checks HTTP through the binding, following redirects by the Worker rules', async () => {
      const fetch = vi
        .fn<VpcBinding['fetch']>(async () => new Response('ok'))
        .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/moved' } }))
        .mockResolvedValueOnce(new Response('ok'));

      const result = await checkMonitor(
        createTarget({ checkProxy: 'vpc' }),
        vpcCtx({ fetch, connect: vi.fn<VpcBinding['connect']>(async () => socket()) }),
        deps,
      );

      expect(result.location).toBe('SFO');
      expect(result.result).toMatchObject({ ok: true });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch.mock.calls[0]?.[0]).toBe('https://example.com');
      expect(fetch.mock.calls[0]?.[1]?.redirect).toBe('manual');
      expect(fetch.mock.calls[1]?.[0]).toBe('https://example.com/moved');
    });

    it('checks TCP_PING through the binding', async () => {
      const connect = vi.fn<VpcBinding['connect']>(async () => socket());

      const result = await checkMonitor(
        createTarget({ method: 'TCP_PING', target: '10.0.1.50:6379', checkProxy: 'vpc' }),
        vpcCtx({ fetch: vi.fn<VpcBinding['fetch']>(), connect }),
        deps,
      );

      expect(result.location).toBe('SFO');
      expect(result.result).toMatchObject({ ok: true });
      expect(connect).toHaveBeenCalledWith({ hostname: '10.0.1.50', port: 6379 });
    });

    it('falls back to a direct check when the binding cannot reach the target', async () => {
      const fetch = vi.fn<VpcBinding['fetch']>(async () => {
        throw new Error('VPC Network cannot connect');
      });
      fetchMock.mockResolvedValueOnce(new Response('ok'));

      const result = await checkMonitor(
        createTarget({ checkProxy: 'vpc', checkProxyFallback: true }),
        vpcCtx({ fetch, connect: vi.fn<VpcBinding['connect']>(async () => socket()) }),
        deps,
      );

      expect(result.location).toBe('SFO');
      expect(result.result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(urls()).toEqual(['https://example.com']);
    });

    it('confirms a failed direct check through the binding', async () => {
      fetchMock.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
      const fetch = vi.fn<VpcBinding['fetch']>(async () => new Response('ok'));

      const result = await checkMonitor(
        createTarget({ confirmVia: 'vpc' }),
        vpcCtx({ fetch, connect: vi.fn<VpcBinding['connect']>(async () => socket()) }),
        deps,
      );

      expect(result.location).toBe('SFO');
      expect(result.result.ok).toBe(true);
      expect(urls()).toEqual(['https://example.com']);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]?.[0]).toBe('https://example.com');
    });
  });

  describe('capabilities', () => {
    it.each([
      [
        'a POST through Globalping',
        { method: 'POST', checkProxy: 'globalping://TOKEN' },
        'checkProxy: method POST is not supported by Globalping',
      ],
      [
        'a body through Globalping',
        { body: '{"hello":"world"}', checkProxy: 'globalping://TOKEN' },
        'checkProxy: body is not supported by Globalping',
      ],
      [
        'a certificate check from the Worker',
        { sslCheckEnabled: true },
        'sslCheckEnabled is not supported by a direct check',
      ],
      [
        'an ICMP ping from the Worker',
        { method: 'TCP_PING', target: 'example.com:443', pingProtocol: 'icmp' },
        "pingProtocol 'icmp' is not supported by a direct check",
      ],
      [
        'an ICMP ping through an external proxy',
        {
          method: 'TCP_PING',
          target: 'example.com:443',
          pingProtocol: 'icmp',
          checkProxy: 'https://proxy.example.com/check',
        },
        "checkProxy: pingProtocol 'icmp' is not supported by an external proxy",
      ],
      [
        'a header assertion through Globalping',
        { responseHeaderEquals: { 'X-A': '1' }, checkProxy: 'globalping://TOKEN' },
        'checkProxy: responseHeaderEquals is not supported by Globalping',
      ],
      [
        'a JSON assertion on a TCP_PING, even through Globalping',
        {
          method: 'TCP_PING',
          target: 'example.com:443',
          responseJsonPath: '$.ok',
          responseJsonValue: true,
          checkProxy: 'globalping://TOKEN',
        },
        'responseJsonPath is not supported by TCP_PING',
      ],
      [
        'a header assertion on a TCP_PING',
        { method: 'TCP_PING', target: 'example.com:443', responseHeaderEquals: { 'X-A': '1' } },
        'responseHeaderEquals is not supported by TCP_PING',
      ],
      [
        'a keyword on a TCP_PING',
        { method: 'TCP_PING', target: 'example.com:443', responseKeyword: 'ok' },
        'responseKeyword is not supported by TCP_PING',
      ],
      [
        'expected status codes on a TCP_PING',
        { method: 'TCP_PING', target: 'example.com:443', expectedCodes: [200] },
        'expectedCodes is not supported by TCP_PING',
      ],
      [
        'a certificate check through the VPC binding',
        { sslCheckEnabled: true, checkProxy: 'vpc' },
        'checkProxy: sslCheckEnabled is not supported by the VPC binding',
      ],
      [
        'a certificate check whose fallback is the Worker',
        { sslCheckEnabled: true, checkProxy: 'globalping://TOKEN', checkProxyFallback: true },
        'checkProxyFallback: sslCheckEnabled is not supported by a direct check',
      ],
    ] satisfies [string, Partial<MonitorTarget>, string][])(
      'refuses %s before checking anything',
      async (_case, overrides, error) => {
        const target = createTarget(overrides);

        const result = await checkMonitor(target, createCtx(), deps);

        expect(result).toEqual({ location: 'SFO', result: { ok: false, error } });
        expect(planIssues(target)).toEqual([error]);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(connectMock).not.toHaveBeenCalled();
      },
    );

    it('checks JSON through Globalping, which reports the body', () => {
      const target = createTarget({
        responseJsonPath: '$.status',
        responseJsonValue: 'ok',
        checkProxy: 'globalping://TOKEN',
      });
      expect(planIssues(target)).toEqual([]);
    });

    it.each(['checkProxy', 'confirmVia'] as const)(
      'plans header and JSON checks through an external proxy as %s',
      (via) => {
        const target = createTarget({
          responseHeaderEquals: { 'X-A': '1' },
          responseJsonPath: '$.status',
          responseJsonValue: 'ok',
          [via]: 'https://proxy.example.com/check',
        });
        expect(planIssues(target)).toEqual([]);
      },
    );

    it('falls back to the Worker for a header check when the proxy is too old', async () => {
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ location: 'FRA', result: { ok: true, latency: 3 } })),
        )
        .mockResolvedValueOnce(new Response('ok'));

      const result = await checkMonitor(
        createTarget({
          responseHeaderEquals: { 'X-A': '1' },
          checkProxy: 'https://proxy.example.com/check',
          checkProxyFallback: true,
        }),
        createCtx(),
        deps,
      );

      expect(result).toMatchObject({
        location: 'SFO',
        result: { ok: false, error: 'Header "X-A" not found in response' },
      });
      expect(urls()).toEqual(['https://proxy.example.com/check', 'https://example.com']);
    });

    it('checks the certificate through a proxy that can see it', async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ location: 'FRA', result: { ok: true, latency: 3 } })),
      );
      const target = createTarget({
        sslCheckEnabled: true,
        checkProxy: 'https://proxy.example.com/check',
      });

      const result = await checkMonitor(target, createCtx(), deps);

      expect(result).toEqual({ location: 'FRA', result: { ok: true, latency: 3 } });
      expect(planIssues(target)).toEqual([]);
    });
  });

  describe('confirmVia', () => {
    it('records the confirmation and its location when the first check fails', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('unavailable', { status: 500 }))
        .mockResolvedValueOnce(json({ id: 'm1' }, 202))
        .mockResolvedValueOnce(finishedAt('DE', 'Frankfurt', 30));

      const result = await checkMonitor(
        createTarget({ confirmVia: 'globalping://CONFIRM' }),
        createCtx(),
        deps,
      );

      expect(result).toEqual({ location: 'DE/Frankfurt', result: { ok: true, latency: 30 } });
      expect(urls()).toEqual(['https://example.com', GLOBALPING_API, `${GLOBALPING_API}/m1`]);
      expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
        Authorization: 'Bearer CONFIRM',
      });
    });

    it('records a failed confirmation as the result', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('unavailable', { status: 500 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ location: 'home-lab', result: { ok: false, error: 'Refused' } }),
          ),
        );

      const result = await checkMonitor(
        createTarget({ confirmVia: 'https://proxy.example.com/check' }),
        createCtx(),
        deps,
      );

      expect(result).toEqual({ location: 'home-lab', result: { ok: false, error: 'Refused' } });
      expect(fetchMock.mock.calls[1]?.[0]).toBe('https://proxy.example.com/check');
    });

    it('does not confirm a check that passed', async () => {
      fetchMock.mockResolvedValueOnce(new Response('ok'));

      const result = await checkMonitor(
        createTarget({ confirmVia: 'https://proxy.example.com/check' }),
        createCtx(),
        deps,
      );

      expect(result).toMatchObject({ location: 'SFO', result: { ok: true } });
      expect(urls()).toEqual(['https://example.com']);
    });

    it('refuses a confirmation place that cannot run the check, even while the check passes', async () => {
      const result = await checkMonitor(
        createTarget({ responseHeaderEquals: { 'X-A': '1' }, confirmVia: 'globalping://TOKEN' }),
        createCtx(),
        deps,
      );

      expect(result).toEqual({
        location: 'SFO',
        result: {
          ok: false,
          error: 'confirmVia: responseHeaderEquals is not supported by Globalping',
        },
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(connectMock).not.toHaveBeenCalled();
    });

    it('keeps the monitor down when the confirming proxy is too old for its JSON check', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('no status', { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ location: 'home-lab', result: { ok: true, latency: 6 } })),
        );

      const result = await checkMonitor(
        createTarget({
          responseJsonPath: '$.ok',
          responseJsonValue: true,
          confirmVia: 'https://proxy.example.com/check',
        }),
        createCtx(),
        deps,
      );

      expect(result).toEqual({
        location: 'ERROR',
        result: {
          ok: false,
          error: 'Proxy is too old for header and JSON checks: update to flarewatch-proxy 2.0.0',
        },
      });
    });

    it('lets a proxy with contract 2 confirm a JSON check', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('no status', { status: 200 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ contract: 2, location: 'home-lab', result: { ok: true, latency: 6 } }),
          ),
        );

      const result = await checkMonitor(
        createTarget({
          responseJsonPath: '$.ok',
          responseJsonValue: true,
          confirmVia: 'https://proxy.example.com/check',
        }),
        createCtx(),
        deps,
      );

      expect(result).toEqual({ location: 'home-lab', result: { ok: true, latency: 6 } });
    });
  });

  describe('Globalping polling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function confirmThroughGlobalping(subrequests: number) {
      let polls = 0;
      fetchMock.mockImplementation(async (url) => {
        if (String(url) === 'https://example.com') return new Response('reset', { status: 500 });
        if (String(url) === GLOBALPING_API) return json({ id: 'm1' }, 202);
        polls += 1;
        return polls < 3 ? inProgress() : finishedAt('DE', 'Berlin', 5);
      });
      const ctx = createCtx({ subrequests });
      const pending = checkMonitor(createTarget({ confirmVia: 'globalping://TOKEN' }), ctx, deps);
      await vi.advanceTimersByTimeAsync(5_000);
      return { result: await pending, ctx };
    }

    it('pays for every poll past the first from the run budget', async () => {
      const { result, ctx } = await confirmThroughGlobalping(4);

      expect(result).toEqual({ location: 'DE/Berlin', result: { ok: true, latency: 5 } });
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(ctx.budget.subrequests).toBe(0);
    });

    it('stops polling when the run has no subrequests left', async () => {
      const { result, ctx } = await confirmThroughGlobalping(2);

      expect(result).toEqual({
        location: 'ERROR',
        result: { ok: false, error: 'GlobalPing: no subrequests left in this check run' },
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(ctx.budget.subrequests).toBe(0);
    });

    it('sends no request after the run deadline, even once nobody waits for it', async () => {
      fetchMock
        .mockResolvedValueOnce(json({ id: 'm1' }, 202))
        .mockImplementation(async () => inProgress());

      const pending = checkMonitor(
        createTarget({ checkProxy: 'globalping://TOKEN' }),
        createCtx({ deadline: Date.now() + 1_500 }),
        deps,
      );
      await vi.advanceTimersByTimeAsync(1_500);
      expect((await pending).result.ok).toBe(false);
      const sent = fetchMock.mock.calls.length;

      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetchMock).toHaveBeenCalledTimes(sent);
    });
  });

  describe('run budget', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    describe.each(['direct', 'vpc'])('%s HTTP redirects', (adapter) => {
      function context(subrequests: number): CheckContext {
        const ctx = createCtx({ subrequests });
        if (adapter === 'vpc')
          ctx.env.VPC = {
            fetch: (input) => fetchMock(input instanceof Request ? input.url : input.toString()),
            connect: vi.fn(),
          };
        return ctx;
      }

      const target = () => createTarget(adapter === 'vpc' ? { checkProxy: 'vpc' } : {});

      it.each([
        [0, 0, 1, true],
        [1, 2, 2, false],
        [20, 20, 21, true],
      ])(
        'with %i spare requests and %i redirects makes %i fetches',
        async (spare, redirects, requests, ok) => {
          fetchMock.mockImplementation(async (input) => {
            const hop = Number(new URL(input).pathname.slice(1));
            return hop < redirects
              ? new Response(null, { status: 302, headers: { location: `/${hop + 1}` } })
              : new Response('ok');
          });

          const result = await checkMonitor(target(), context(spare), deps);

          expect(fetchMock).toHaveBeenCalledTimes(requests);
          expect(result.result.ok).toBe(ok);
          if (!ok)
            expect(result.result).toMatchObject({
              error: 'No subrequests left in this check run',
            });
        },
      );

      it.each([false, true])(
        'starts no fetch after the deadline (first fetch completed: %s)',
        async (fetched) => {
          vi.useFakeTimers();
          const ctx = context(20);
          if (!fetched) vi.setSystemTime(ctx.budget.deadline);
          fetchMock.mockImplementation(async () => {
            vi.setSystemTime(ctx.budget.deadline);
            return new Response(null, { status: 302, headers: { location: '/next' } });
          });

          const result = await checkMonitor(target(), ctx, deps);

          expect(fetchMock).toHaveBeenCalledTimes(fetched ? 1 : 0);
          expect(result.result).toMatchObject({ ok: false, error: 'The check run ended' });
        },
      );
    });

    it('cuts the timeout to what is left of the run', async () => {
      fetchMock.mockResolvedValue(new Response('ok'));

      await checkMonitor(
        createTarget({ timeout: 60_000 }),
        createCtx({ deadline: Date.now() + 5_000 }),
        deps,
      );

      const timeout = fetchMock.mock.calls[0]?.[1]?.timeout ?? Infinity;
      expect(timeout).toBeLessThanOrEqual(5_000);
      expect(timeout).toBeGreaterThan(4_000);
    });

    it('stops a check that outlasts the run at its deadline', async () => {
      vi.useFakeTimers();
      fetchMock.mockReturnValue(new Promise(() => {}));
      const started = Date.now();

      const pending = checkMonitor(createTarget(), createCtx({ deadline: started + 3_000 }), deps);
      await vi.advanceTimersByTimeAsync(3_000);
      const result = await pending;

      expect(result).toEqual({
        location: 'SFO',
        result: { ok: false, error: 'Check stopped at the end of the check run', latency: 3_000 },
      });
      expect(Date.now() - started).toBe(3_000);
    });

    it('spends one subrequest on a fallback', async () => {
      fetchMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(new Response('ok'));
      const ctx = createCtx({ subrequests: 1 });

      await checkMonitor(
        createTarget({ checkProxy: 'https://proxy.example.com', checkProxyFallback: true }),
        ctx,
        deps,
      );

      expect(ctx.budget.subrequests).toBe(0);
      expect(urls()).toEqual(['https://proxy.example.com', 'https://example.com']);
    });

    it.each([
      ['no subrequests', () => ({ subrequests: 0 })],
      ['under a second', () => ({ deadline: Date.now() + 500 })],
    ])('keeps the first failure when the run has %s left', async (_case, budget) => {
      fetchMock.mockRejectedValueOnce(new Error('boom'));

      const result = await checkMonitor(
        createTarget({ checkProxy: 'https://proxy.example.com', checkProxyFallback: true }),
        createCtx(budget()),
        deps,
      );

      expect(result).toEqual({
        location: 'ERROR',
        result: { ok: false, error: 'Proxy error: boom' },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe('runBudget', () => {
  const monitors = (count: number, overrides: Partial<MonitorTarget> = {}) =>
    Array.from({ length: count }, (_, i) => createTarget({ id: `m${i}`, ...overrides }));

  it('ends every check inside the minute, leaving time for the hub and alerts', () => {
    expect(runBudget(monitors(3), 0, 0).deadline).toBe(55_000);
  });

  it('keeps the checks, extra attempts and the hub call within 50 subrequests', () => {
    const { subrequests } = runBudget(monitors(45), 0);
    expect(45 + subrequests + 1).toBeLessThanOrEqual(50);
    expect(runBudget(monitors(60), 0).subrequests).toBe(0);
  });

  it('counts a Globalping check as at least two subrequests: create and poll', () => {
    const { subrequests } = runBudget(monitors(1, { checkProxy: 'globalping://TOKEN' }), 0);
    expect(subrequests).toBeLessThanOrEqual(runBudget([], 0).subrequests - 2);
  });

  it('counts a VPC check as one subrequest, like a direct check', () => {
    const spare = runBudget([], 0).subrequests;
    expect(spare - runBudget(monitors(1, { checkProxy: 'vpc' }), 0).subrequests).toBe(1);
    expect(runBudget(monitors(1, { checkProxy: 'vpc' }), 0).subrequests).toBe(
      runBudget(monitors(1), 0).subrequests,
    );
  });

  it('holds one request for each webhook', () => {
    expect(runBudget(monitors(45), 2).subrequests).toBe(runBudget(monitors(45), 0).subrequests - 2);
  });

  it('counts nothing for a heartbeat', () => {
    const heartbeat = {
      id: 'job',
      name: 'Job',
      method: 'HEARTBEAT',
      periodSeconds: 60,
      graceSeconds: 0,
    } as const;
    expect(runBudget([heartbeat], 0).subrequests).toBe(runBudget([], 0).subrequests);
  });
});

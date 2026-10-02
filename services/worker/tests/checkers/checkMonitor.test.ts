import { describe, it, expect, beforeEach, afterEach, vi } from 'vite-plus/test';
import type { CheckContext, Fetcher, MonitorTarget } from '@flarewatch/shared';
import { checkMonitor, planIssues, runBudget } from '../../src/checkers';
import type { CheckDeps } from '../../src/checkers/deps';
import { GlobalPingChecker } from '../../src/checkers/globalping';

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
      createCtx(),
      deps,
    );

    expect(result).toEqual({ location: 'LON', result: { ok: true, latency: 1 } });
    expect(globalPingCheckMock).toHaveBeenCalledTimes(1);
    expect(globalPingCheckMock.mock.calls[0]?.[1]).toBe('globalping://TOKEN');
    expect(getEdgeLocationMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
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
    const { checkProxy: _checkProxy, ...monitor } = target;
    expect(JSON.parse(options?.body as string)).toEqual(monitor);
  });

  it('falls back to direct when the proxy fails', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    httpCheckMock.mockResolvedValue({ ok: true, latency: 9 });

    const result = await checkMonitor(
      createTarget({
        checkProxy: 'https://proxy.example.com',
        checkProxyFallback: true,
      }),
      createCtx(),
      deps,
    );

    expect(result).toEqual({ location: 'SFO', result: { ok: true, latency: 9 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getEdgeLocationMock).toHaveBeenCalledTimes(1);
    expect(httpCheckMock).toHaveBeenCalledTimes(1);
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
      createCtx(),
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
      createCtx(),
      deps,
    );

    expect(result).toEqual({ location: 'SFO', result: { ok: true, latency: 7 } });
    expect(globalPingCheckMock).toHaveBeenCalledTimes(1);
    expect(getEdgeLocationMock).toHaveBeenCalledTimes(1);
    expect(httpCheckMock).toHaveBeenCalledTimes(1);
  });

  it('delegates to TCP checker when method is TCP_PING', async () => {
    tcpCheckMock.mockResolvedValue({ ok: true, latency: 5 });

    const result = await checkMonitor(
      createTarget({ method: 'TCP_PING', target: 'example.com:80' }),
      createCtx(),
      deps,
    );

    expect(result).toEqual({ location: 'SFO', result: { ok: true, latency: 5 } });
    expect(getEdgeLocationMock).toHaveBeenCalledTimes(1);
    expect(tcpCheckMock).toHaveBeenCalledTimes(1);
    expect(httpCheckMock).not.toHaveBeenCalled();
  });

  it('delegates to HTTP checker for non-TCP monitors', async () => {
    httpCheckMock.mockResolvedValue({ ok: false, error: 'bad', latency: 1 });

    const result = await checkMonitor(createTarget({ method: 'POST' }), createCtx(), deps);

    expect(result).toEqual({ location: 'SFO', result: { ok: false, error: 'bad', latency: 1 } });
    expect(getEdgeLocationMock).toHaveBeenCalledTimes(1);
    expect(httpCheckMock).toHaveBeenCalledTimes(1);
    expect(tcpCheckMock).not.toHaveBeenCalled();
  });

  it('returns a located failure instead of throwing when a checker crashes', async () => {
    httpCheckMock.mockRejectedValue(new Error('Check crashed'));

    const result = await checkMonitor(createTarget(), createCtx(), deps);

    expect(result).toEqual({
      location: 'SFO',
      result: { ok: false, error: 'Check failed: Error: Check crashed' },
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
        'a header assertion through an external proxy',
        { responseHeaderEquals: { 'X-A': '1' }, checkProxy: 'https://proxy.example.com/check' },
        'checkProxy: responseHeaderEquals is not supported by an external proxy',
      ],
      [
        'a JSON assertion through an external proxy',
        {
          responseJsonPath: '$.status',
          responseJsonValue: 'ok',
          checkProxy: 'https://proxy.example.com/check',
        },
        'checkProxy: responseJsonPath is not supported by an external proxy',
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
        expect(httpCheckMock).not.toHaveBeenCalled();
        expect(tcpCheckMock).not.toHaveBeenCalled();
        expect(globalPingCheckMock).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
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
      httpCheckMock.mockResolvedValue({ ok: false, error: 'Connection reset' });
      globalPingCheckMock.mockResolvedValue({
        location: 'DE/Frankfurt',
        result: { ok: true, latency: 30 },
      });

      const result = await checkMonitor(
        createTarget({ confirmVia: 'globalping://CONFIRM' }),
        createCtx(),
        deps,
      );

      expect(result).toEqual({ location: 'DE/Frankfurt', result: { ok: true, latency: 30 } });
      expect(globalPingCheckMock.mock.calls[0]?.[1]).toBe('globalping://CONFIRM');
    });

    it('records a failed confirmation as the result', async () => {
      httpCheckMock.mockResolvedValue({ ok: false, error: 'Connection reset' });
      fetchMock.mockResolvedValue(
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
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://proxy.example.com/check');
    });

    it('does not confirm a check that passed', async () => {
      httpCheckMock.mockResolvedValue({ ok: true, latency: 4 });

      const result = await checkMonitor(
        createTarget({ confirmVia: 'https://proxy.example.com/check' }),
        createCtx(),
        deps,
      );

      expect(result).toEqual({ location: 'SFO', result: { ok: true, latency: 4 } });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a confirmation place that cannot run the check, even while the check passes', async () => {
      httpCheckMock.mockResolvedValue({ ok: true, latency: 4 });

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
        location: 'SFO',
        result: {
          ok: false,
          error: 'confirmVia: responseJsonPath is not supported by an external proxy',
        },
      });
      expect(httpCheckMock).not.toHaveBeenCalled();
    });
  });

  describe('Globalping polling', () => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const inProgress = () => json({ status: 'in-progress', results: [] });
    const finished = () =>
      json({
        status: 'finished',
        results: [
          {
            probe: { country: 'DE', city: 'Berlin' },
            result: { status: 'finished', statusCode: 200, rawBody: 'ok', timings: { total: 5 } },
          },
        ],
      });
    const globalPingDeps = { ...deps, globalPing: new GlobalPingChecker(fetchMock) };

    beforeEach(() => {
      vi.useFakeTimers();
      fetchMock.mockReset();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function confirmThroughGlobalping(subrequests: number) {
      httpCheckMock.mockResolvedValue({ ok: false, error: 'Connection reset' });
      fetchMock
        .mockResolvedValueOnce(json({ id: 'm1' }, 202))
        .mockResolvedValueOnce(inProgress())
        .mockResolvedValueOnce(inProgress())
        .mockResolvedValueOnce(finished());
      const ctx = createCtx({ subrequests });
      const pending = checkMonitor(
        createTarget({ confirmVia: 'globalping://TOKEN' }),
        ctx,
        globalPingDeps,
      );
      await vi.advanceTimersByTimeAsync(5_000);
      return { result: await pending, ctx };
    }

    it('pays for every poll past the first from the run budget', async () => {
      const { result, ctx } = await confirmThroughGlobalping(4);

      expect(result).toEqual({ location: 'DE/Berlin', result: { ok: true, latency: 5 } });
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(ctx.budget.subrequests).toBe(0);
    });

    it('stops polling when the run has no subrequests left', async () => {
      const { result, ctx } = await confirmThroughGlobalping(2);

      expect(result).toEqual({
        location: 'ERROR',
        result: { ok: false, error: 'GlobalPing: no subrequests left in this check run' },
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(ctx.budget.subrequests).toBe(0);
    });

    it('sends no request after the run deadline, even once nobody waits for it', async () => {
      fetchMock
        .mockResolvedValueOnce(json({ id: 'm1' }, 202))
        .mockImplementation(async () => inProgress());

      const pending = checkMonitor(
        createTarget({ checkProxy: 'globalping://TOKEN' }),
        createCtx({ deadline: Date.now() + 1_500 }),
        globalPingDeps,
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

    it('cuts the timeout to what is left of the run', async () => {
      httpCheckMock.mockResolvedValue({ ok: true, latency: 1 });

      await checkMonitor(
        createTarget({ timeout: 60_000 }),
        createCtx({ deadline: Date.now() + 5_000 }),
        deps,
      );

      const timeout = httpCheckMock.mock.calls[0]?.[0].timeout ?? Infinity;
      expect(timeout).toBeLessThanOrEqual(5_000);
      expect(timeout).toBeGreaterThan(4_000);
    });

    it('stops a check that outlasts the run at its deadline', async () => {
      vi.useFakeTimers();
      httpCheckMock.mockReturnValue(new Promise(() => {}));
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
      fetchMock.mockRejectedValue(new Error('boom'));
      httpCheckMock.mockResolvedValue({ ok: true, latency: 9 });
      const ctx = createCtx({ subrequests: 1 });

      await checkMonitor(
        createTarget({ checkProxy: 'https://proxy.example.com', checkProxyFallback: true }),
        ctx,
        deps,
      );

      expect(httpCheckMock).toHaveBeenCalledTimes(1);
      expect(ctx.budget.subrequests).toBe(0);
    });

    it.each([
      ['no subrequests', () => ({ subrequests: 0 })],
      ['under a second', () => ({ deadline: Date.now() + 500 })],
    ])('keeps the first failure when the run has %s left', async (_case, budget) => {
      fetchMock.mockRejectedValue(new Error('boom'));

      const result = await checkMonitor(
        createTarget({ checkProxy: 'https://proxy.example.com', checkProxyFallback: true }),
        createCtx(budget()),
        deps,
      );

      expect(result).toEqual({
        location: 'ERROR',
        result: { ok: false, error: 'Proxy error: boom' },
      });
      expect(httpCheckMock).not.toHaveBeenCalled();
    });
  });
});

describe('runBudget', () => {
  const monitors = (count: number, overrides: Partial<MonitorTarget> = {}) =>
    Array.from({ length: count }, (_, i) => createTarget({ id: `m${i}`, ...overrides }));

  it('ends every check inside the minute', () => {
    expect(runBudget(monitors(3), 0, 0).deadline).toBeLessThanOrEqual(60_000);
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

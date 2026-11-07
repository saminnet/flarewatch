import { afterEach, expect, it, vi } from 'vite-plus/test';
import type { Fetcher, MonitorTarget, VpcBinding } from '@flarewatch/shared';
import { checkMonitor, runBudget } from '../src/checkers';
import { runChecks } from '../src/index';
import { createCheckDeps, createWorkerDeps } from './helpers/worker-deps';
import { createHub, hubNamespace } from './helpers/hub';

const target: MonitorTarget = {
  id: 'api',
  name: 'API',
  method: 'GET',
  target: 'https://api.example.com',
};

afterEach(() => {
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

it.each(['direct', 'vpc'] as const)(
  'overlaps the trace and %s check without extra requests',
  async (adapter) => {
    vi.resetModules();
    vi.useFakeTimers();
    const { getEdgeLocation } = await import('../src/utils/location');
    const trace = deferred<Response>();
    const reply = deferred<Response>();
    const requests: string[] = [];
    const fetcher: Fetcher = (url) => {
      requests.push(String(url));
      return String(url).includes('/cdn-cgi/trace') ? trace.promise : reply.promise;
    };
    const deps = {
      ...createCheckDeps(fetcher),
      getEdgeLocation: () => getEdgeLocation(fetcher),
    };
    const binding: VpcBinding = {
      fetch: (url) => fetcher(url instanceof Request ? url.url : String(url)),
      connect: async () => {
        throw new Error('Unexpected TCP connection');
      },
    };
    const monitor = { ...target, ...(adapter === 'vpc' && { checkProxy: 'vpc' }) };
    const budget = runBudget([monitor], 0);
    const pending = checkMonitor(monitor, { env: { VPC: binding }, budget }, deps);

    expect(requests).toEqual(['https://cloudflare.com/cdn-cgi/trace', target.target]);
    trace.resolve(new Response('colo=HEL\n'));
    await vi.advanceTimersByTimeAsync(100);
    reply.resolve(new Response('ok'));
    expect(await pending).toMatchObject({ location: 'HEL', result: { ok: true } });
    expect(requests).toHaveLength(2);
    expect(budget.subrequests).toBe(46);
  },
);

it.each(['direct', 'vpc'] as const)(
  'retains trace and %s network failures without an unhandled rejection',
  async (adapter) => {
    vi.resetModules();
    vi.useFakeTimers();
    const { getEdgeLocation } = await import('../src/utils/location');
    const trace = deferred<Response>();
    const reply = deferred<Response>();
    const requests: string[] = [];
    const fetcher: Fetcher = (url) => {
      requests.push(String(url));
      return String(url).includes('/cdn-cgi/trace') ? trace.promise : reply.promise;
    };
    const deps = {
      ...createCheckDeps(fetcher),
      getEdgeLocation: () => getEdgeLocation(fetcher),
    };
    const binding: VpcBinding = {
      fetch: (url) => fetcher(url instanceof Request ? url.url : String(url)),
      connect: async () => {
        throw new Error('Unexpected TCP connection');
      },
    };
    const monitor = { ...target, ...(adapter === 'vpc' && { checkProxy: 'vpc' }) };
    const pending = checkMonitor(
      monitor,
      { env: { VPC: binding }, budget: runBudget([monitor], 0) },
      deps,
    );

    expect(requests).toHaveLength(2);
    reply.reject(new Error('api.example.com refused the connection'));
    await vi.advanceTimersByTimeAsync(100);
    trace.reject(new Error('Trace unavailable'));
    expect(await pending).toMatchObject({
      location: 'ERROR',
      result: { ok: false, error: 'api.example.com refused the connection' },
    });
    expect(requests).toHaveLength(2);
  },
);

// Workers queue a seventh connection that waits for headers. A trace beside six checks
// would put its time into one check's latency.
it('finishes the trace before a scheduled run starts its checks', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const { getEdgeLocation } = await import('../src/utils/location');
  const trace = deferred<Response>();
  const requests: string[] = [];
  const fetcher: Fetcher = async (url) => {
    requests.push(String(url));
    return String(url).includes('/cdn-cgi/trace')
      ? trace.promise
      : Response.json({ location: 'SIN', result: { ok: true, latency: 12 } });
  };
  const monitor = { ...target, checkProxy: 'https://proxy.example.com/check' };
  const deps = {
    ...createWorkerDeps({ monitors: [monitor] }, { fetcher }),
    getEdgeLocation: () => getEdgeLocation(fetcher),
  };
  const { hub } = createHub();
  const pending = runChecks({ MONITOR_HUB: hubNamespace(hub) }, deps);

  await vi.advanceTimersByTimeAsync(100);
  expect(requests).toEqual(['https://cloudflare.com/cdn-cgi/trace']);
  trace.resolve(new Response('colo=HEL\n'));
  await pending;
  expect(requests).toEqual([
    'https://cloudflare.com/cdn-cgi/trace',
    'https://proxy.example.com/check',
  ]);
  expect(hub.view().monitors.api?.status).toBe('up');
});

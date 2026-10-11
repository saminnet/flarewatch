import { expect, it, vi } from 'vite-plus/test';
import Worker, { runChecks } from '../src/index';
import type { CheckContext, MonitorTarget } from '@flarewatch/shared';
import { checkMonitor } from '../src/checkers';
import { createNotifier } from '../src/notifications/webhook';
import { getEdgeLocation } from '../src/utils/location';
import { createHub, hubNamespace } from './helpers/hub';
import { freezeClock } from '@flarewatch/shared/testing/clock';

it.each([0, 60_001])(
  'concurrent triggers share initialization admission; retry after %i ms',
  async (retryMs) => {
    vi.useFakeTimers();
    const start = 1736942400000;
    vi.setSystemTime(start);
    const { hub } = createHub();
    const env = { MONITOR_HUB: hubNamespace(hub) };
    const completions: ((response: Response) => void)[] = [];
    const pending: Promise<unknown>[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
      if ((input instanceof Request ? input.url : input.toString()).includes('/cdn-cgi/trace'))
        return Promise.resolve(new Response('colo=HEL\n'));
      return new Promise<Response>((resolve) => completions.push(resolve));
    });
    const deps = {
      checkMonitor,
      createNotifier,
      getEdgeLocation,
      staticConfig: {
        monitors: [
          { id: 'dummy', name: 'Dummy', method: 'GET' as const, target: 'https://dummy.test' },
        ],
      },
    };
    const ctx = {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
    };
    // Every status page isolate that finds an empty hub sends one of these.
    const trigger = () =>
      Worker.fetch(
        new Request('https://internal/trigger', { method: 'POST' }),
        env,
        ctx as typeof ctx & ExecutionContext,
        deps,
      );
    const triggerTwice = () => Promise.all([trigger(), trigger()]);
    await triggerTwice();
    await vi.waitFor(() => expect(completions).toHaveLength(1));
    expect(pending).toHaveLength(1);
    vi.setSystemTime(start + 20_001);
    await triggerTwice();
    expect(pending).toHaveLength(1);
    if (retryMs) {
      vi.setSystemTime(start + retryMs);
      await triggerTwice();
      await vi.waitFor(() => expect(completions).toHaveLength(2));
      expect(pending).toHaveLength(2);
      completions[1]?.(new Response('ok'));
      await pending[1];
      completions[0]?.(new Response('ok'));
      await pending[0];
      expect(hub.view().lastUpdate).toBe(Math.floor((start + retryMs) / 1000));
    } else {
      completions[0]?.(new Response('ok'));
      await Promise.all(pending);
      vi.setSystemTime(start + 60_001);
      await triggerTwice();
      expect(pending).toHaveLength(1);
      expect(hub.view().lastUpdate).toBe(start / 1000);
    }
  },
);

it('cron completion prevents a later initialization trigger', async () => {
  const { hub } = createHub();
  const env = { MONITOR_HUB: hubNamespace(hub) };
  vi.stubGlobal('fetch', async () => new Response('ok'));
  const deps = {
    checkMonitor,
    createNotifier,
    getEdgeLocation: () => getEdgeLocation(async () => new Response('colo=HEL\n')),
    staticConfig: {
      monitors: [
        { id: 'dummy', name: 'Dummy', method: 'GET' as const, target: 'https://dummy.test' },
      ],
    },
  };
  await runChecks(env, deps);
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
  };
  await Worker.fetch(
    new Request('https://internal/trigger', { method: 'POST' }),
    env,
    ctx as typeof ctx & ExecutionContext,
    deps,
  );
  await Promise.all(pending);
  expect(pending).toHaveLength(0);
});

it('initialization admission leaves room for hub recording and an alert', async () => {
  vi.resetModules();
  const { default: worker } = await import('../src/index');
  const { checkMonitor: check } = await import('../src/checkers');
  const { getEdgeLocation: locate } = await import('../src/utils/location');
  let networkRequests = 0;
  let deliveries = 0;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    networkRequests++;
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('/cdn-cgi/trace')) return new Response('colo=HEL\n');
    if (url === 'https://hook.test/') {
      deliveries++;
      return new Response('ok');
    }
    return new Response(null, { status: 307, headers: { location: '/next' } });
  });
  const { hub } = createHub();
  const admission = vi.spyOn(hub, 'claimInitialCheck');
  const recording = vi.spyOn(hub, 'record');
  const confirmation = vi.spyOn(hub, 'confirmAlerts');
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => {
      pending.push(promise);
    },
  };
  await worker.fetch(
    new Request('https://internal/trigger', { method: 'POST' }),
    { MONITOR_HUB: hubNamespace(hub) },
    ctx as typeof ctx & ExecutionContext,
    {
      checkMonitor: check,
      getEdgeLocation: locate,
      createNotifier,
      staticConfig: {
        monitors: Array.from({ length: 40 }, (_, i) => ({
          id: `m${i}`,
          name: `m${i}`,
          method: 'GET' as const,
          target: `https://m${i}.test`,
        })),
        notification: { webhook: { url: 'https://hook.test/' }, summaryAfter: 2 },
      },
    },
  );
  await Promise.all(pending);
  expect(
    networkRequests +
      admission.mock.calls.length +
      recording.mock.calls.length +
      confirmation.mock.calls.length,
  ).toBeLessThanOrEqual(50);
  expect(deliveries).toBe(1);
  expect(Object.keys(hub.view().monitors)).toHaveLength(40);
});

it('ends the checks of a triggered run within 20 seconds', async () => {
  freezeClock(1_800_000_000_000, { dateOnly: true });
  const { hub } = createHub();
  const env = { MONITOR_HUB: hubNamespace(hub) };
  const deadlines: number[] = [];
  const deps = {
    checkMonitor: async (_monitor: MonitorTarget, ctx: CheckContext) => {
      deadlines.push(ctx.budget.deadline);
      return { location: 'HEL', result: { ok: true as const, latency: 1 } };
    },
    createNotifier,
    getEdgeLocation: async () => 'HEL',
    staticConfig: {
      monitors: [{ id: 'api', name: 'API', method: 'GET' as const, target: 'https://api.test' }],
    },
  };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) };
  const start = Date.now();
  await Worker.fetch(
    new Request('https://internal/trigger', { method: 'POST' }),
    env,
    ctx as typeof ctx & ExecutionContext,
    deps,
  );
  await Promise.all(pending);
  expect(deadlines).toHaveLength(1);
  expect(deadlines[0]! - start).toBeLessThanOrEqual(20_000);
});

it('defers an alert the triggered run cannot send in time to the next run', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const start = 1_800_000_000_000;
  vi.setSystemTime(start);
  const { hub } = createHub();
  const env = { MONITOR_HUB: hubNamespace(hub) };
  const hooks: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    hooks.push(input instanceof Request ? input.url : input.toString());
    return new Response('ok');
  });
  const deps = {
    checkMonitor: async () => {
      // A slow first run: a 5 s webhook started now would end past 27 s.
      vi.setSystemTime(start + 23_000);
      return { location: 'HEL', result: { ok: false as const, error: 'Unavailable' } };
    },
    createNotifier,
    getEdgeLocation: async () => 'HEL',
    staticConfig: {
      monitors: [{ id: 'api', name: 'API', method: 'GET' as const, target: 'https://api.test' }],
      notification: { webhook: { url: 'https://hook.test/alert' } },
    },
  };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) };
  await Worker.fetch(
    new Request('https://internal/trigger', { method: 'POST' }),
    env,
    ctx as typeof ctx & ExecutionContext,
    deps,
  );
  await Promise.all(pending);
  expect(hub.view().monitors.api?.status).toBe('down');
  expect(hooks).toEqual([]);

  await runChecks(env, deps);
  expect(hooks).toEqual(['https://hook.test/alert']);
});

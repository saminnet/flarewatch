import { afterEach, expect, it, vi } from 'vite-plus/test';
import Worker, { runChecks } from '../src/index';
import { checkMonitor } from '../src/checkers';
import { createNotifier } from '../src/notifications/webhook';
import { getEdgeLocation } from '../src/utils/location';
import { createHub, hubNamespace } from './helpers/hub';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each([0, 60_001])(
  'two page isolates share initialization admission; retry after %i ms',
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
    const binding = {
      fetch: (input: Request | string, init?: RequestInit) =>
        Worker.fetch(new Request(input, init), env, ctx as typeof ctx & ExecutionContext, deps),
    };
    vi.resetModules();
    (await import('./helpers/cloudflare-workers')).env.MONITOR_WORKER = binding;
    const first = await import('../../../apps/status-page/src/lib/snapshots');
    vi.resetModules();
    (await import('./helpers/cloudflare-workers')).env.MONITOR_WORKER = binding;
    const second = await import('../../../apps/status-page/src/lib/snapshots');
    await Promise.all([first.readVisitorSnapshot(), second.readVisitorSnapshot()]);
    await vi.waitFor(() => expect(completions).toHaveLength(1));
    expect(pending).toHaveLength(1);
    vi.setSystemTime(start + 20_001);
    await Promise.all([first.readVisitorSnapshot(), second.readVisitorSnapshot()]);
    expect(pending).toHaveLength(1);
    if (retryMs) {
      vi.setSystemTime(start + retryMs);
      await Promise.all([first.readVisitorSnapshot(), second.readVisitorSnapshot()]);
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
      await Promise.all([first.readVisitorSnapshot(), second.readVisitorSnapshot()]);
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

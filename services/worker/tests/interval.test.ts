import { afterEach, expect, it, vi } from 'vite-plus/test';
import type { PullMonitor } from '@flarewatch/shared';
import { runChecks } from '../src/index';
import { createHub, hubNamespace } from './helpers/hub';
import { createWorkerDeps } from './helpers/worker-deps';
import { getEdgeLocation } from '../src/utils/location';
import { createNotifier } from '../src/notifications/webhook';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('spreads checks by id, preserves skipped incidents and still counts reminder runs', async () => {
  vi.useFakeTimers();
  const monitors: PullMonitor[] = ['a', 'b', 'c'].map((id) => ({
    id,
    name: id,
    method: 'GET',
    target: `https://${id}.example.com`,
    checkEveryMinutes: 3,
  }));
  const { hub } = createHub();
  const env = { MONITOR_HUB: hubNamespace(hub) };
  const checked: string[][] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      if (input === 'https://cloudflare.com/cdn-cgi/trace') return new Response('colo=HEL');
      if (typeof input === 'string')
        checked[checked.length - 1]!.push(new URL(input).hostname.split('.')[0]!);
      return new Response('down', { status: 503 });
    }),
  );
  const deps = { ...createWorkerDeps({ monitors }), getEdgeLocation };
  for (let minute = 0; minute < 6; minute++) {
    vi.setSystemTime((1800000000 + minute * 60) * 1000);
    checked.push([]);
    await runChecks(env, deps);
  }
  expect(checked.slice(0, 3)).toEqual([['c'], ['a'], ['b']]);
  expect(checked.slice(3)).toEqual(checked.slice(0, 3));
  for (const monitor of monitors) {
    expect(hub.view().monitors[monitor.id]?.status).toBe('down');
    expect(hub.latency(monitor.id, 1800000300)).toHaveLength(2);
    expect(hub.view().monitors[monitor.id]?.incidents).toHaveLength(1);
  }
});

it('counts skipped minute runs for reminders and uses the scheduled minute for a delayed cron', async () => {
  vi.useFakeTimers();
  const start = Date.parse('2025-01-15T00:37:00Z');
  const sent: string[] = [];
  let checks = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      if (input === 'https://cloudflare.com/cdn-cgi/trace') return new Response('colo=HEL');
      if (input === 'https://hooks.example/alert') {
        sent.push(typeof init?.body === 'string' ? init.body : '');
        return new Response('ok');
      }
      checks++;
      return new Response('down', { status: 503 });
    }),
  );
  const monitor: PullMonitor = {
    id: 'a',
    name: 'API',
    method: 'GET',
    target: 'https://example.com',
    checkEveryMinutes: 60,
    reminderEveryChecks: 30,
  };
  const { hub } = createHub();
  const deps = {
    ...createWorkerDeps({
      monitors: [monitor],
      notification: { webhook: { url: 'https://hooks.example/alert', payload: { text: '$MSG' } } },
    }),
    getEdgeLocation,
    createNotifier,
  };
  for (let minute = 0; minute <= 30; minute++) {
    vi.setSystemTime(start + (minute + 1) * 60000);
    await runChecks({ MONITOR_HUB: hubNamespace(hub) }, deps, start + minute * 60000);
  }
  expect(checks).toBe(1);
  expect(sent).toHaveLength(2);
  expect(sent[1]).toContain('reminder 1');
  expect(hub.view().monitors.a?.incidents).toHaveLength(1);
});

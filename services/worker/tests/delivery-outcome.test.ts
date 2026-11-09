import { expect, it, vi } from 'vite-plus/test';
import type { Fetcher } from '@flarewatch/shared';
import { runChecks } from '../src/index';
import { createHub, hubNamespace } from './helpers/hub';
import { createWorkerDeps } from './helpers/worker-deps';
import { check, down } from './helpers/check-records';

it.each([
  { input: 'no notifier', state: 'sent', attempts: 0, calls: 0 },
  { input: 'unknown monitor', state: 'pending', attempts: 1, calls: 0 },
  { input: 'unknown monitor with summary', state: 'sending', attempts: 0, calls: 0 },
  { input: 'success', state: 'sent', attempts: 0, calls: 1 },
  { input: 'failure', state: 'pending', attempts: 1, calls: 1 },
  { input: 'deadline hit', state: 'pending', attempts: 0, calls: 0 },
  { input: 'subscriber only', state: 'sent', attempts: 0, calls: 0 },
  { input: 'success then failure', state: 'sent', attempts: 0, calls: 2 },
])('replays delivery input: $input', async ({ input, state, attempts, calls }) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(1_800_000_000_000);
  const { hub, db } = createHub();
  const monitor = check('api', down()).monitor;
  const subscribers = input === 'no notifier' || input === 'subscriber only';
  const config = {
    monitors: [monitor],
    notification: {
      ...(input === 'unknown monitor with summary' && { summaryAfter: 2 }),
      webhook:
        input === 'no notifier'
          ? []
          : [
              {
                url: 'https://hooks.example/first',
                payload: '$MSG',
                ...(input === 'subscriber only' && { monitors: ['other'] }),
              },
              ...(input === 'success then failure'
                ? [{ url: 'https://hooks.example/second', payload: '$MSG' }]
                : []),
            ],
    },
  };
  const sent: string[] = [];
  const network: Fetcher = async (url) => {
    if (typeof url === 'string' && url.startsWith('https://hooks.example/')) {
      sent.push(url);
      return new Response('reply', {
        status: input === 'failure' || url.endsWith('/second') ? 503 : 200,
      });
    }
    if (input.startsWith('unknown monitor')) config.monitors.length = 0;
    if (input === 'deadline hit') vi.setSystemTime(1_800_000_027_000);
    return new Response('down', { status: 503 });
  };
  vi.stubGlobal('fetch', network);
  const deps = {
    ...createWorkerDeps(config, { fetcher: network }),
    ...(subscribers && { pageConfig: { subscribers: { from: 'status@example.com' } } }),
  };
  await runChecks({ MONITOR_HUB: hubNamespace(hub) }, deps, undefined, 0, input === 'deadline hit');
  expect(db.prepare('SELECT alert, alert_attempts FROM incidents').all()).toEqual([
    { alert: state, alert_attempts: attempts },
  ]);
  expect(sent).toHaveLength(calls);
  expect(db.prepare('SELECT kind FROM subscriber_outbox').all()).toEqual(
    subscribers ? [{ kind: 'down' }] : [],
  );
});

import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type {
  Fetcher,
  HeartbeatMonitor,
  Maintenance,
  Monitor,
  MonitorTarget,
  NotificationConfig,
  WorkerConfig,
} from '@flarewatch/shared';
import { runChecks } from '../src/index';
import { createNotifier, type NotificationContext } from '../src/notifications/webhook';
import { createHub, hubNamespace } from './helpers/hub';

const T = Date.parse('2025-01-15T12:00:00Z') / 1000;

function pull(id: string, dependsOn?: string[]): Monitor {
  return {
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
    method: 'GET',
    target: `https://${id}.example.com`,
    ...(dependsOn && { dependsOn }),
  };
}

function job(id: string, dependsOn?: string[]): HeartbeatMonitor {
  return {
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
    method: 'HEARTBEAT',
    periodSeconds: 60,
    graceSeconds: 0,
    ...(dependsOn && { dependsOn }),
  };
}

function maintenance(monitors: string[], start: number, end: number): Maintenance {
  return {
    id: `m-${start}`,
    body: 'Planned work',
    monitors,
    start: new Date(start * 1000).toISOString(),
    end: new Date(end * 1000).toISOString(),
    createdAt: 0,
    updatedAt: 0,
  };
}

/** A deployment with an in-memory hub. `run` is one cron run; `alerts` drains what it sent. */
function deployment(
  monitors: Monitor[],
  notification: NotificationConfig = {},
  secretWebhooks?: string,
) {
  const db = new DatabaseSync(':memory:');
  let { hub } = createHub({}, db);
  const failing = new Map<string, string>();
  const sent: NotificationContext[] = [];
  const config: WorkerConfig = {
    monitors,
    notification: { webhook: { url: 'https://hooks.example.com' }, ...notification },
  };
  const refusing = new Set<string>();
  const unformattable = new Set<string>();
  let duringDelivery: (() => Promise<void>) | undefined;
  const fetcher = vi.fn<Fetcher>(async (url) => {
    const hook = duringDelivery;
    duringDelivery = undefined;
    await hook?.();
    return new Response('', { status: refusing.has(new URL(String(url)).host) ? 500 : 200 });
  });

  return {
    config,
    get hub() {
      return hub;
    },
    down(id: string, error = 'Unavailable') {
      failing.set(id, error);
    },
    up(id: string) {
      failing.delete(id);
    },
    /** Webhook hosts that answer 500. */
    refuse(host = 'hooks.example.com') {
      refusing.add(host);
    },
    accept(host = 'hooks.example.com') {
      refusing.delete(host);
    },
    /** Monitors whose message cannot be formatted, like a config with a bad time zone. */
    breakFormatting(id: string) {
      unformattable.add(id);
    },
    fixFormatting(id: string) {
      unformattable.delete(id);
    },
    deliveryAttempts: () => fetcher.mock.calls.length,
    requests: () => fetcher.mock.calls.map(([, init]) => init),
    /** The host of every webhook call so far. */
    deliveredTo: () => fetcher.mock.calls.map(([url]) => new URL(String(url)).host),
    /** Runs `hook` inside the next webhook call, as a run that overlaps the delivery. */
    whileDelivering(hook: () => Promise<void>) {
      duringDelivery = hook;
    },
    /** A new hub instance over the same storage, as after an eviction. */
    restart() {
      hub = createHub({}, db).hub;
    },
    async run(at: number) {
      vi.setSystemTime(at * 1000);
      await runChecks(
        {
          MONITOR_HUB: hubNamespace(hub),
          ...(secretWebhooks !== undefined && { FLAREWATCH_WEBHOOKS: secretWebhooks }),
        },
        {
          checkMonitor: async (monitor) => {
            const error = failing.get(monitor.id);
            return {
              location: 'SFO',
              result: error === undefined ? { ok: true, latency: 10 } : { ok: false, error },
            };
          },
          // An alert counts as sent when at least one destination accepted it.
          createNotifier: (webhook) => {
            const notifier = createNotifier(webhook, fetcher);
            if (!notifier) return null;
            const send = notifier.send.bind(notifier);
            vi.spyOn(notifier, 'send').mockImplementation(async (ctx, message) => {
              const results = await send(ctx, message);
              if (results.some((result) => result.success)) sent.push(ctx);
              return results;
            });
            return notifier;
          },
          formatNotificationMessage: (ctx) => {
            if (unformattable.has(ctx.monitor.id)) throw new RangeError('Invalid time zone');
            return 'message';
          },
          getEdgeLocation: async () => 'SFO',
          staticConfig: config,
        },
      );
    },
    /** Alerts sent since the last call, as "id down|up [(also: A, B)]". */
    alerts(): string[] {
      const lines = sent.map(
        (ctx) =>
          `${ctx.monitor.id} ${ctx.isUp ? 'up' : 'down'}${ctx.alsoDown.length > 0 ? ` (also: ${ctx.alsoDown.join(', ')})` : ''}`,
      );
      sent.length = 0;
      return lines;
    },
    lastSent: () => sent[sent.length - 1],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('alerts for monitors with dependencies', () => {
  it('sends one alert, for the dependency, when both fail in the same run', async () => {
    const d = deployment([pull('gateway'), pull('app', ['gateway'])]);
    d.down('gateway');
    d.down('app');

    await d.run(T);

    expect(d.alerts()).toEqual(['gateway down (also: App)']);
  });

  it('decides the same regardless of config order', async () => {
    const d = deployment([pull('app', ['gateway']), pull('gateway')]);
    d.down('gateway');
    d.down('app');

    await d.run(T);

    expect(d.alerts()).toEqual(['gateway down (also: App)']);
  });

  it('holds a dependent for one run, so a dependency failing a run later still covers it', async () => {
    const d = deployment([pull('gateway'), pull('app', ['gateway'])]);
    d.down('app');
    await d.run(T);
    expect(d.alerts()).toEqual([]);

    d.down('gateway');
    await d.run(T + 60);
    expect(d.alerts()).toEqual(['gateway down (also: App)']);
  });

  it('sends nothing for a dependent that fails after its dependency', async () => {
    const d = deployment([pull('gateway'), pull('app', ['gateway'])]);
    d.down('gateway');
    await d.run(T);
    expect(d.alerts()).toEqual(['gateway down']);

    d.down('app');
    await d.run(T + 60);
    await d.run(T + 120);
    expect(d.alerts()).toEqual([]);
  });

  it('covers a chain of dependencies', async () => {
    const d = deployment([pull('gateway'), pull('app', ['gateway']), pull('dashboard', ['app'])]);
    d.down('gateway');
    d.down('app');
    d.down('dashboard');

    await d.run(T);

    expect(d.alerts()).toEqual(['gateway down (also: App, Dashboard)']);
  });

  it('blocks a monitor whose dependency is up but depends on one that is down', async () => {
    const d = deployment([pull('gateway'), pull('app', ['gateway']), pull('dashboard', ['app'])]);
    d.down('gateway');
    d.down('dashboard');

    await d.run(T);
    await d.run(T + 60);

    expect(d.alerts()).toEqual(['gateway down (also: Dashboard)']);
  });

  it('blocks a monitor when any one of its dependencies is down', async () => {
    const d = deployment([pull('gateway'), pull('vpn'), pull('app', ['gateway', 'vpn'])]);
    d.down('vpn');
    d.down('app');

    await d.run(T);

    expect(d.alerts()).toEqual(['vpn down (also: App)']);
  });

  it('sends one up alert when both recover together', async () => {
    const d = deployment([pull('gateway'), pull('app', ['gateway'])]);
    d.down('gateway');
    d.down('app');
    await d.run(T);
    d.alerts();

    d.up('gateway');
    d.up('app');
    await d.run(T + 60);

    expect(d.alerts()).toEqual(['gateway up']);
  });

  it('lets a dependent still down after its dependency recovers alert in the same run', async () => {
    const d = deployment([pull('gateway'), pull('app', ['gateway'])]);
    d.down('gateway');
    d.down('app', 'HTTP 502');
    await d.run(T);
    d.alerts();

    d.up('gateway');
    await d.run(T + 60);
    expect(d.alerts()).toEqual(['gateway up', 'app down']);

    d.up('app');
    await d.run(T + 120);
    expect(d.alerts()).toEqual(['app up']);
  });

  it('gives the still-down alert its incident start and latest error', async () => {
    const d = deployment([pull('gateway'), pull('app', ['gateway'])]);
    d.down('gateway');
    d.down('app', 'HTTP 502');
    await d.run(T);
    d.up('gateway');
    d.alerts();

    await d.run(T + 60);

    expect(d.lastSent()).toMatchObject({
      monitor: { id: 'app' },
      isUp: false,
      incidentStartTime: T,
      currentTime: T + 60,
      reason: 'HTTP 502',
    });
  });

  it('sends no up alert for a blocked dependent that recovers', async () => {
    const d = deployment([pull('gateway'), pull('app', ['gateway'])]);
    d.down('gateway');
    d.down('app');
    await d.run(T);
    d.alerts();

    d.up('app');
    await d.run(T + 60);

    expect(d.alerts()).toEqual([]);
  });

  it('sends nothing for a dependent that recovers within its one-run hold', async () => {
    const d = deployment([pull('gateway'), pull('app', ['gateway'])]);
    d.down('app');
    await d.run(T);
    d.up('app');
    await d.run(T + 60);

    expect(d.alerts()).toEqual([]);
  });

  it('blocks dependents of a dependency that is down during its maintenance', async () => {
    const d = deployment([pull('gateway'), pull('app', ['gateway'])]);
    d.hub.putMaintenance(maintenance(['gateway'], T - 60, T + 3600));
    d.down('gateway');
    d.down('app');

    await d.run(T);
    await d.run(T + 60);

    expect(d.alerts()).toEqual([]);
  });

  it('blocks a heartbeat that depends on a down monitor', async () => {
    const d = deployment([pull('gateway'), job('backup', ['gateway'])]);
    d.hub.ping(job('backup', ['gateway']), 'fail', T - 10);
    d.down('gateway');

    await d.run(T);
    await d.run(T + 60);

    expect(d.alerts()).toEqual(['gateway down (also: Backup)']);
  });

  it('keeps dependents blocked while a down job is running again', async () => {
    const backup = job('backup');
    const d = deployment([backup, pull('app', ['backup'])]);
    d.hub.ping(backup, 'success', T - 200);
    d.down('app');
    await d.run(T);
    expect(d.alerts()).toEqual(['backup down (also: App)']);

    d.hub.ping(backup, 'start', T + 60);
    await d.run(T + 60);

    expect(d.hub.view().monitors.backup?.heartbeat?.status).toBe('running');
    expect(d.alerts()).toEqual([]);
  });

  it('alerts for a running job whose incident was held back by maintenance', async () => {
    const backup = job('backup');
    const d = deployment([backup]);
    d.hub.putMaintenance(maintenance(['backup'], T - 60, T + 90));
    d.hub.ping(backup, 'success', T - 200);
    await d.run(T);
    expect(d.alerts()).toEqual([]);

    d.hub.ping(backup, 'start', T + 120);
    await d.run(T + 120);

    expect(d.hub.view().monitors.backup?.heartbeat?.status).toBe('running');
    expect(d.alerts()).toEqual(['backup down']);
  });

  describe('a dependent that alerted on its own', () => {
    async function alertedApp() {
      const d = deployment([pull('gateway'), pull('app', ['gateway'])]);
      d.down('app', 'HTTP 502');
      await d.run(T);
      await d.run(T + 60);
      expect(d.alerts()).toEqual(['app down']);
      return d;
    }

    it('sends no error change while blocked', async () => {
      const d = await alertedApp();
      d.down('gateway');
      d.down('app', 'Timeout');

      await d.run(T + 120);

      expect(d.alerts()).toEqual(['gateway down (also: App)']);
    });

    it('still sends its up alert while its dependency is down', async () => {
      const d = await alertedApp();
      d.down('gateway');
      await d.run(T + 120);
      d.alerts();

      d.up('app');
      await d.run(T + 180);

      expect(d.alerts()).toEqual(['app up']);
    });
  });

  it('sends the up alert of an incident that alerted before dependsOn was added', async () => {
    const d = deployment([pull('gateway'), pull('app')]);
    d.down('app');
    await d.run(T);
    expect(d.alerts()).toEqual(['app down']);

    d.config.monitors = [pull('gateway'), pull('app', ['gateway'])];
    d.down('gateway');
    d.up('app');
    await d.run(T + 60);

    expect(d.alerts()).toEqual(['gateway down', 'app up']);
  });
});

describe('alert state', () => {
  it('alerts once when the grace period is reached, even when that run is missed', async () => {
    const d = deployment([pull('api')], { gracePeriod: 2 });
    d.down('api');

    await d.run(T);
    expect(d.alerts()).toEqual([]);
    await d.run(T + 300);
    expect(d.alerts()).toEqual(['api down']);
    await d.run(T + 360);
    expect(d.alerts()).toEqual([]);

    d.up('api');
    await d.run(T + 420);
    expect(d.alerts()).toEqual(['api up']);
  });

  it('sends no up alert for an outage that ended inside the grace period', async () => {
    const d = deployment([pull('api')], { gracePeriod: 2 });
    d.down('api');
    await d.run(T);
    d.up('api');
    await d.run(T + 60);

    expect(d.alerts()).toEqual([]);
  });

  it('sends one down alert with the latest error when it becomes due on an error change', async () => {
    const d = deployment([pull('api')], { gracePeriod: 1 });
    d.down('api', 'Timeout');
    await d.run(T);
    d.down('api', 'HTTP 502');
    await d.run(T + 60);

    expect(d.lastSent()).toMatchObject({ reason: 'HTTP 502' });
    expect(d.alerts()).toEqual(['api down']);
  });

  it('alerts once a maintenance window ends if the monitor is still down', async () => {
    const d = deployment([pull('api')]);
    d.hub.putMaintenance(maintenance(['api'], T - 60, T + 120));
    d.down('api');

    await d.run(T);
    await d.run(T + 60);
    expect(d.alerts()).toEqual([]);

    await d.run(T + 180);
    expect(d.alerts()).toEqual(['api down']);
  });

  it('sends no error change during maintenance but closes the alert when the monitor recovers', async () => {
    const d = deployment([pull('api')]);
    d.down('api', 'Timeout');
    await d.run(T);
    expect(d.alerts()).toEqual(['api down']);

    d.hub.putMaintenance(maintenance(['api'], T + 30, T + 3600));
    d.down('api', 'HTTP 502');
    await d.run(T + 60);
    expect(d.alerts()).toEqual([]);

    d.up('api');
    await d.run(T + 120);
    expect(d.alerts()).toEqual(['api up']);
  });

  it('stops every alert for a monitor added to skipNotificationIds', async () => {
    const d = deployment([pull('api')]);
    d.down('api', 'Timeout');
    await d.run(T);
    expect(d.alerts()).toEqual(['api down']);

    d.config.notification = { ...d.config.notification, skipNotificationIds: ['api'] };
    d.down('api', 'HTTP 502');
    await d.run(T + 60);
    d.up('api');
    await d.run(T + 120);

    expect(d.alerts()).toEqual([]);
  });

  it('keeps the alert state across a hub restart', async () => {
    const d = deployment([pull('api')]);
    d.down('api');
    await d.run(T);
    expect(d.alerts()).toEqual(['api down']);

    d.restart();
    await d.run(T + 60);
    expect(d.alerts()).toEqual([]);

    d.up('api');
    await d.run(T + 120);
    expect(d.alerts()).toEqual(['api up']);
  });

  it('treats an empty webhook list as no webhook', async () => {
    const d = deployment([pull('api')]);
    const { webhook } = d.config.notification!;
    d.config.notification = { webhook: [] };
    d.down('api');
    await d.run(T);

    d.config.notification = { webhook: webhook! };
    await d.run(T + 60);
    d.up('api');
    await d.run(T + 120);

    expect(d.alerts()).toEqual(['api down', 'api up']);
  });

  it('sends an error change for an alerted monitor that is not blocked', async () => {
    const d = deployment([pull('gateway'), pull('app', ['gateway'])]);
    d.down('app', 'Timeout');
    await d.run(T);
    await d.run(T + 60);
    d.alerts();

    d.down('app', 'HTTP 502');
    await d.run(T + 120);

    expect(d.lastSent()).toMatchObject({ reason: 'HTTP 502' });
    expect(d.alerts()).toEqual(['app down']);
  });

  it('does not hold a dependent again in a second run within the same second', async () => {
    const d = deployment([pull('gateway'), pull('app', ['gateway'])]);
    d.down('app');
    await d.run(T);
    await d.run(T);

    expect(d.alerts()).toEqual(['app down']);
  });

  it('decides nothing without a webhook, so one added later sends a down alert first', async () => {
    const d = deployment([pull('api')]);
    const { webhook } = d.config.notification!;
    d.config.notification = {};
    d.down('api');
    await d.run(T);

    d.config.notification = { webhook: webhook! };
    await d.run(T + 60);

    expect(d.alerts()).toEqual(['api down']);
  });
});

describe('alert delivery', () => {
  it('tries a down alert again on each run until a webhook accepts it', async () => {
    const d = deployment([pull('api')]);
    d.refuse();
    d.down('api');
    await d.run(T);
    expect(d.alerts()).toEqual([]);

    d.accept();
    await d.run(T + 60);
    expect(d.alerts()).toEqual(['api down']);
    await d.run(T + 120);
    expect(d.alerts()).toEqual([]);

    d.up('api');
    await d.run(T + 180);
    expect(d.alerts()).toEqual(['api up']);
  });

  it('sends no recovery for an outage whose down alert never got through', async () => {
    const d = deployment([pull('api')]);
    d.refuse();
    d.down('api');
    await d.run(T);

    d.accept();
    d.up('api');
    await d.run(T + 60);

    expect(d.alerts()).toEqual([]);
  });

  it('counts a down alert as delivered when any one webhook accepts it', async () => {
    const d = deployment([pull('api')], {
      webhook: [{ url: 'https://hooks.example.com' }, { url: 'https://backup.example.com' }],
    });
    d.refuse('backup.example.com');
    d.down('api');
    await d.run(T);
    expect(d.alerts()).toEqual(['api down']);

    const attempts = d.deliveryAttempts();
    await d.run(T + 60);
    expect(d.deliveryAttempts()).toBe(attempts);
  });

  it('gives up after ten failed tries and then sends nothing for that outage', async () => {
    const d = deployment([pull('api')]);
    d.refuse();
    d.down('api');
    for (let run = 0; run < 12; run++) await d.run(T + run * 60);
    expect(d.deliveryAttempts()).toBe(10);

    d.accept();
    await d.run(T + 720);
    d.up('api');
    await d.run(T + 780);

    expect(d.deliveryAttempts()).toBe(10);
    expect(d.alerts()).toEqual([]);
  });

  it('keeps sending the other alerts when one cannot be formatted, and retries that one', async () => {
    const d = deployment([pull('broken'), pull('api')]);
    d.breakFormatting('broken');
    d.down('broken');
    d.down('api');
    await d.run(T);
    expect(d.alerts()).toEqual(['api down']);

    d.fixFormatting('broken');
    await d.run(T + 60);
    expect(d.alerts()).toEqual(['broken down']);
  });

  it('sends the recovery when the outage ends while its down alert is being delivered', async () => {
    const d = deployment([pull('api')]);
    d.down('api');
    d.whileDelivering(async () => {
      d.up('api');
      await d.run(T + 60);
    });

    await d.run(T);

    expect(d.lastSent()).toMatchObject({ isUp: true, currentTime: T + 60 });
    expect(d.alerts()).toEqual(['api down', 'api up']);
  });

  it('does not send a down alert twice when a second run overlaps its delivery', async () => {
    const d = deployment([pull('api')]);
    d.down('api');
    d.whileDelivering(() => d.run(T + 30));

    await d.run(T);

    expect(d.alerts()).toEqual(['api down']);
  });

  it('sends a down alert again if the run that claimed it never reported back', async () => {
    const policy = { gracePeriodSeconds: 0, skipIds: [], skipErrorChanges: false };
    const d = deployment([pull('api')]);
    const failing = { location: 'SFO', result: { ok: false as const, error: 'Unavailable' } };
    const record = (at: number) =>
      d.hub.record(at, [{ monitor: pull('api') as MonitorTarget, check: failing }], policy);

    expect(record(T).alerts).toMatchObject([{ kind: 'down' }]);
    expect(record(T + 60).alerts).toEqual([]);
    expect(record(T + 15 * 60).alerts).toEqual([]);
    expect(record(T + 20 * 60).alerts).toMatchObject([{ kind: 'down' }]);
  });
});

describe('webhooks in the FLAREWATCH_WEBHOOKS secret', () => {
  function logErrors() {
    const logged: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => logged.push(line));
    return logged;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('alerts through the secret when the config has no webhook', async () => {
    const d = deployment([pull('api')], { webhook: [] }, '{"url": "https://secret.example.com"}');
    d.down('api');

    await d.run(T);

    expect(d.alerts()).toEqual(['api down']);
    expect(d.deliveredTo()).toEqual(['secret.example.com']);
  });

  it('alerts the config webhook and every webhook in the secret', async () => {
    const secret = JSON.stringify([
      { url: 'https://one.example.com' },
      { url: 'https://two.example.com', template: 'slack' },
    ]);
    const d = deployment([pull('api')], {}, secret);
    d.down('api');

    await d.run(T);

    expect(d.deliveredTo().sort()).toEqual([
      'hooks.example.com',
      'one.example.com',
      'two.example.com',
    ]);
  });

  it('skips a bad entry and still alerts the rest, without logging the secret', async () => {
    const logged = logErrors();
    const secret = JSON.stringify([
      { url: 'not-a-url/T0SECRET', template: 'slack' },
      { url: 'https://two.example.com', template: 'nope' },
      { url: 'https://three.example.com', headers: { T0SECRET: ['not', 'a', 'string'] } },
      { url: 'https://four.example.com' },
    ]);
    const d = deployment([pull('api')], { webhook: [] }, secret);
    d.down('api');

    await d.run(T);

    expect(d.deliveredTo()).toEqual(['four.example.com']);
    expect(logged).toHaveLength(3);
    expect(logged.join('\n')).toMatch(/webhook 1\.url/);
    expect(logged.join('\n')).toMatch(/webhook 2\.template/);
    expect(logged.join('\n')).toMatch(/webhook 3\.headers/);
    expect(logged.join('\n')).not.toMatch(/T0SECRET|two\.example\.com/);
  });

  it('keeps alerting the config webhook when the secret is not JSON', async () => {
    const logged = logErrors();
    const d = deployment([pull('api')], {}, 'https://hooks.slack.com/services/T0SECRET');
    d.down('api');

    await d.run(T);

    expect(d.deliveredTo()).toEqual(['hooks.example.com']);
    expect(logged.join('\n')).toMatch(/not valid JSON/);
    expect(logged.join('\n')).not.toMatch(/T0SECRET/);
  });

  it('sends the method upper-cased when the secret writes it in lower case', async () => {
    const secret =
      '{"url": "https://one.example.com", "method": "patch", "payload": {"text": "$MSG"}}';
    const d = deployment([pull('api')], { webhook: [] }, secret);
    d.down('api');

    await d.run(T);

    expect(d.alerts()).toEqual(['api down']);
    expect(d.requests()).toMatchObject([{ method: 'PATCH' }]);
  });
});

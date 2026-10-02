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
import type { Alert } from '../src/hub/alerts';
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

function label(ctx: NotificationContext): string {
  if (ctx.kind === 'recovered') return 'up';
  return ctx.kind === 'reminder' ? `reminder ${String(ctx.reminder)}` : ctx.kind;
}

/** A monitor that sends a reminder every 30 check runs while it stays down. */
function reminding(id: string, dependsOn?: string[]): Monitor {
  return { ...pull(id, dependsOn), reminderEveryChecks: 30 };
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
  const sent: { ctx: NotificationContext; message: string }[] = [];
  const config: WorkerConfig = {
    monitors,
    notification: { webhook: { url: 'https://hooks.example.com' }, ...notification },
  };
  const refusing = new Set<string>();
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
              if (results.some((result) => result.success)) sent.push({ ctx, message });
              return results;
            });
            return notifier;
          },
          getEdgeLocation: async () => 'SFO',
          staticConfig: config,
        },
      );
    },
    /** Alerts sent since the last call, as "id down|error|reminder N|up [(also: A, B)]". */
    alerts(): string[] {
      const lines = sent.map(
        ({ ctx }) =>
          `${ctx.monitor.id} ${label(ctx)}${ctx.alsoDown.length > 0 ? ` (also: ${ctx.alsoDown.join(', ')})` : ''}`,
      );
      sent.length = 0;
      return lines;
    },
    lastSent: () => sent[sent.length - 1]?.ctx,
    /** The text of the last alert sent, as a custom payload's $MSG gets it. */
    lastMessage: () => sent[sent.length - 1]?.message,
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
      kind: 'down',
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

  it('alerts again when a monitor fails soon after its recovery alert', async () => {
    const d = deployment([pull('api')]);
    d.down('api');
    await d.run(T);
    d.up('api');
    await d.run(T + 60);
    d.down('api');
    await d.run(T + 120);

    expect(d.alerts()).toEqual(['api down', 'api up', 'api down']);
  });

  it('waits a full grace period again when a monitor fails soon after recovering', async () => {
    const d = deployment([pull('api')], { gracePeriod: 2 });
    d.down('api');
    await d.run(T);
    d.up('api');
    await d.run(T + 60);
    d.down('api');
    await d.run(T + 180);
    await d.run(T + 240);
    expect(d.alerts()).toEqual([]);

    await d.run(T + 300);
    expect(d.alerts()).toEqual(['api down']);
  });

  it('sends at most five error changes per outage', async () => {
    const d = deployment([pull('api')]);
    d.down('api', 'error 0');
    await d.run(T);
    d.alerts();

    for (let i = 1; i <= 8; i++) {
      d.down('api', `error ${i}`);
      await d.run(T + i * 60);
    }

    expect(d.lastSent()).toMatchObject({ reason: 'error 5' });
    expect(d.alerts()).toHaveLength(5);
  });

  it('gives back an error change no webhook accepted, so five still reach a webhook', async () => {
    const d = deployment([pull('api')]);
    d.down('api', 'error 0');
    await d.run(T);
    d.refuse();
    d.down('api', 'error 1');
    await d.run(T + 60);
    d.accept();
    d.alerts();

    for (let i = 2; i <= 8; i++) {
      d.down('api', `error ${i}`);
      await d.run(T + i * 60);
    }

    expect(d.lastSent()).toMatchObject({ reason: 'error 6' });
    expect(d.alerts()).toHaveLength(5);
  });

  it('sends no sixth error change from a run that overlaps the delivery of the fifth', async () => {
    const d = deployment([pull('api')]);
    for (let i = 0; i <= 4; i++) {
      d.down('api', `error ${i}`);
      await d.run(T + i * 60);
    }
    expect(d.alerts()).toEqual(['api down', 'api error', 'api error', 'api error', 'api error']);

    d.down('api', 'error 5');
    d.whileDelivering(() => {
      d.down('api', 'error 6');
      return d.run(T + 330);
    });
    await d.run(T + 300);

    expect(d.alerts()).toEqual(['api error']);
    expect(d.deliveryAttempts()).toBe(6);
  });

  it('sends five more error changes after the outage reopens', async () => {
    const d = deployment([pull('api')]);
    let now = T;
    const fail = async (error: string) => {
      d.down('api', error);
      await d.run((now += 60));
    };
    for (let i = 0; i <= 6; i++) await fail(`first ${i}`);
    d.up('api');
    await d.run((now += 60));
    for (let i = 0; i <= 6; i++) await fail(`second ${i}`);

    expect(d.alerts()).toEqual([
      'api down',
      ...Array<string>(5).fill('api error'),
      'api up',
      'api down',
      ...Array<string>(5).fill('api error'),
    ]);
  });

  it('gives a refused error change back to its own outage, not to the one that reopened it', async () => {
    const d = deployment([pull('api')]);
    d.down('api', 'first 0');
    await d.run(T);
    d.down('api', 'first 1');
    d.whileDelivering(async () => {
      d.up('api');
      await d.run(T + 70);
      d.down('api', 'second 0');
      await d.run(T + 80);
      d.down('api', 'second 1');
      await d.run(T + 90);
      d.refuse();
    });
    await d.run(T + 60);
    d.accept();
    for (let i = 2; i <= 9; i++) {
      d.down('api', `second ${i}`);
      await d.run(T + 60 * i);
    }

    expect(d.alerts()).toEqual([
      'api down',
      'api up',
      'api down',
      ...Array<string>(5).fill('api error'),
    ]);
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
    expect(d.alerts()).toEqual(['app error']);
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

describe('alert messages', () => {
  it('says a monitor is down, and when, on the run its outage began', async () => {
    const d = deployment([pull('api')]);
    d.down('api');
    await d.run(T);

    expect(d.lastMessage()).toBe('🔴 Api is down\nDetected at 1/15, 12:00\nReason: Unavailable');
  });

  it('says a monitor is still down, and for how long, when the grace period delays the alert', async () => {
    const d = deployment([pull('api')], { gracePeriod: 2 });
    d.down('api');
    await d.run(T);
    await d.run(T + 120);

    expect(d.lastMessage()).toBe(
      '🔴 Api is still down\nDown since 1/15, 12:00 (2 minutes)\nReason: Unavailable',
    );
  });

  it('gives an error change the new error and the downtime so far', async () => {
    const d = deployment([pull('api')]);
    d.down('api', 'Timeout');
    await d.run(T);
    d.down('api', 'HTTP 502');
    await d.run(T + 60);

    expect(d.lastSent()).toMatchObject({ kind: 'error' });
    expect(d.lastMessage()).toBe(
      '🔴 Api is still down\nDown since 1/15, 12:00 (1 minutes)\nReason: HTTP 502',
    );
  });

  it('counts a recovery’s downtime from the start of the outage', async () => {
    const d = deployment([pull('api')]);
    d.down('api');
    await d.run(T);
    d.up('api');
    await d.run(T + 420);

    expect(d.lastMessage()).toBe(
      '✅ Api is up!\nThe service recovered after 7 minutes of downtime.',
    );
  });

  it('ends a flapping monitor’s downtime when it came back up, not when the hold ran out', async () => {
    const d = deployment([pull('api')]);
    d.down('api');
    await d.run(T);
    d.up('api');
    await d.run(T + 60);
    d.down('api');
    await d.run(T + 120);
    expect(d.alerts()).toEqual(['api down', 'api up', 'api down']);

    d.up('api');
    await d.run(T + 180);
    expect(d.alerts()).toEqual([]);
    await d.run(T + 180 + 15 * 60);

    expect(d.lastSent()).toMatchObject({ currentTime: T + 180, downtimeSeconds: 180 });
    expect(d.alerts()).toEqual(['api up']);
  });

  it('writes a recovery as one, even in the same second its outage began', async () => {
    const d = deployment([pull('api')], {
      webhook: { url: 'https://hooks.example.com', template: 'text' },
    });
    d.down('api');
    await d.run(T);
    d.up('api');
    await d.run(T);

    expect(d.requests().map((init) => init?.body)).toEqual([
      '🔴 Api is down\nDetected at 1/15, 12:00\nReason: Unavailable',
      '✅ Api is up!\nRecovered after 0 minutes of downtime.',
    ]);
  });
});

describe('reminders', () => {
  /** Runs `count` check runs a minute apart, starting at `from`. Returns the time after the last. */
  async function runs(d: ReturnType<typeof deployment>, from: number, count: number, step = 60) {
    for (let i = 0; i < count; i++) await d.run(from + i * step);
    return from + count * step;
  }

  it('reminds every 30 check runs after the down alert, saying for how long and which reminder', async () => {
    const d = deployment([reminding('api')]);
    d.down('api');
    await runs(d, T, 30);
    expect(d.alerts()).toEqual(['api down']);

    await d.run(T + 30 * 60);
    expect(d.lastMessage()).toBe(
      '🔴 Api is still down (reminder 1)\nDown since 1/15, 12:00 (30 minutes)\nReason: Unavailable',
    );
    expect(d.alerts()).toEqual(['api reminder 1']);

    await runs(d, T + 31 * 60, 29);
    expect(d.alerts()).toEqual([]);
    await d.run(T + 60 * 60);
    expect(d.lastMessage()).toMatch(
      /^🔴 Api is still down \(reminder 2\)\nDown since .* \(60 minutes\)/,
    );
  });

  it('sends no reminder for a monitor without reminderEveryChecks', async () => {
    const d = deployment([pull('api')]);
    d.down('api');
    await runs(d, T, 100);

    expect(d.alerts()).toEqual(['api down']);
  });

  it('counts check runs, not minutes', async () => {
    const d = deployment([reminding('api')]);
    d.down('api');
    await runs(d, T, 30, 120);
    expect(d.alerts()).toEqual(['api down']);

    await d.run(T + 30 * 120);
    expect(d.lastSent()).toMatchObject({ downtimeSeconds: 3600 });
    expect(d.alerts()).toEqual(['api reminder 1']);
  });

  it('counts from the run that delivered the down alert, not the one that found the outage', async () => {
    const d = deployment([reminding('api')]);
    d.refuse();
    d.down('api');
    await runs(d, T, 3);
    d.accept();
    await runs(d, T + 3 * 60, 30);
    expect(d.alerts()).toEqual(['api down']);

    await d.run(T + 33 * 60);
    expect(d.alerts()).toEqual(['api reminder 1']);
  });

  it('sends no reminder during a maintenance window and sends it once the window ends', async () => {
    const d = deployment([reminding('api')]);
    d.hub.putMaintenance(maintenance(['api'], T + 1700, T + 2000));
    d.down('api');
    const after = await runs(d, T, 34);
    expect(d.alerts()).toEqual(['api down']);

    await d.run(after);
    expect(d.alerts()).toEqual(['api reminder 1']);
  });

  it('sends no reminder while a dependency is down', async () => {
    const d = deployment([pull('gateway'), reminding('app', ['gateway'])]);
    d.down('app');
    await runs(d, T, 10);
    d.down('gateway');
    const after = await runs(d, T + 600, 30);
    expect(d.alerts()).toEqual(['app down', 'gateway down (also: App)']);

    d.up('gateway');
    await d.run(after);
    expect(d.alerts()).toEqual(['gateway up', 'app reminder 1']);
  });

  it('sends no reminder while a flapping monitor waits out its recovery hold', async () => {
    const d = deployment([reminding('api')]);
    d.down('api');
    await d.run(T);
    d.up('api');
    await d.run(T + 60);
    d.down('api');
    await runs(d, T + 120, 29);
    d.up('api');
    await runs(d, T + 1860, 16);

    expect(d.alerts()).toEqual(['api down', 'api up', 'api down', 'api up']);
  });

  it('gives a reminder no webhook accepted the same number next time', async () => {
    const d = deployment([reminding('api')]);
    d.down('api');
    await runs(d, T, 30);
    d.refuse();
    await d.run(T + 30 * 60);
    d.accept();
    await runs(d, T + 31 * 60, 30);

    expect(d.lastSent()).toMatchObject({ downtimeSeconds: 60 * 60 });
    expect(d.alerts()).toEqual(['api down', 'api reminder 1']);
  });

  it('numbers reminders from 1 again after the outage reopens', async () => {
    const d = deployment([reminding('api')]);
    d.down('api');
    await runs(d, T, 31);
    d.up('api');
    await d.run(T + 31 * 60);
    d.down('api');
    await runs(d, T + 32 * 60, 31);

    expect(d.lastSent()).toMatchObject({ incidentStartTime: T, downtimeSeconds: 62 * 60 });
    expect(d.alerts()).toEqual([
      'api down',
      'api reminder 1',
      'api up',
      'api down',
      'api reminder 1',
    ]);
  });

  it('numbers the first reminder of a reopened outage 1 when the old one’s outcome comes late', async () => {
    const d = deployment([reminding('api')]);
    d.down('api');
    await runs(d, T, 30);
    d.whileDelivering(async () => {
      d.up('api');
      await d.run(T + 30 * 60 + 10);
      d.down('api');
      await d.run(T + 30 * 60 + 20);
    });
    await d.run(T + 30 * 60);
    await runs(d, T + 31 * 60, 30);

    expect(d.alerts()).toEqual([
      'api down',
      'api up',
      'api down',
      'api reminder 1',
      'api reminder 1',
    ]);
  });

  it('reminds about a heartbeat that stays down', async () => {
    const backup: HeartbeatMonitor = { ...job('backup'), reminderEveryChecks: 30 };
    const d = deployment([backup]);
    d.hub.ping(backup, 'fail', T - 10);
    await runs(d, T, 31);

    expect(d.alerts()).toEqual(['backup down', 'backup reminder 1']);
  });
});

describe('alert routing', () => {
  const ops = { url: 'https://ops.example.com', monitors: ['api'] };
  const all = { url: 'https://all.example.com' };

  it('sends a monitor’s alerts only to the webhooks that take it', async () => {
    const d = deployment([pull('api'), pull('web')], {
      webhook: [ops, all, { url: 'https://none.example.com', monitors: [] }],
    });
    d.down('api', 'Timeout');
    d.down('web');
    await d.run(T);
    d.down('api', 'HTTP 502');
    await d.run(T + 60);
    d.up('api');
    d.up('web');
    await d.run(T + 120);

    expect(d.alerts()).toEqual(['api down', 'web down', 'api error', 'api up', 'web up']);
    expect(d.deliveredTo()).toEqual([
      'ops.example.com',
      'all.example.com',
      'all.example.com',
      'ops.example.com',
      'all.example.com',
      'ops.example.com',
      'all.example.com',
      'all.example.com',
    ]);
  });

  it('never claims a monitor no webhook takes, so it alerts once one does', async () => {
    const d = deployment([pull('api'), pull('web')], { webhook: [ops] });
    d.down('web');
    for (let run = 0; run < 12; run++) await d.run(T + run * 60);
    expect(d.deliveryAttempts()).toBe(0);

    d.config.notification = { webhook: [ops, all] };
    await d.run(T + 720);

    expect(d.alerts()).toEqual(['web down']);
  });

  it('sends nothing for a monitor in skipNotificationIds, even to a webhook that lists it', async () => {
    const d = deployment([pull('api')], { webhook: [ops], skipNotificationIds: ['api'] });
    d.down('api');
    await d.run(T);

    expect(d.deliveryAttempts()).toBe(0);
  });

  it('routes the webhooks in the FLAREWATCH_WEBHOOKS secret too', async () => {
    const d = deployment(
      [pull('api'), pull('web')],
      { webhook: [] },
      JSON.stringify([{ url: 'https://ops.example.com', monitors: ['api'] }]),
    );
    d.down('web');
    await d.run(T);
    d.down('api');
    await d.run(T + 60);

    expect(d.alerts()).toEqual(['api down']);
    expect(d.deliveredTo()).toEqual(['ops.example.com']);
  });

  it('sends a webhook that takes only a dependent nothing while its dependency alerts', async () => {
    const d = deployment([pull('gateway'), pull('app', ['gateway'])], {
      webhook: [{ url: 'https://app-team.example.com', monitors: ['app'] }, all],
    });
    d.down('gateway');
    d.down('app');
    await d.run(T);

    expect(d.alerts()).toEqual(['gateway down (also: App)']);
    expect(d.deliveredTo()).toEqual(['all.example.com']);
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

  it('tries every alert a run cannot format again on the next run', async () => {
    const d = deployment([pull('web'), pull('api')], { timeZone: 'Mars/Olympus_Mons' });
    d.down('web');
    d.down('api');
    await d.run(T);
    expect(d.alerts()).toEqual([]);

    d.config.notification = { ...d.config.notification, timeZone: 'UTC' };
    await d.run(T + 60);
    expect(d.alerts()).toEqual(['web down', 'api down']);
  });

  it('sends the recovery when the outage ends while its down alert is being delivered', async () => {
    const d = deployment([pull('api')]);
    d.down('api');
    d.whileDelivering(async () => {
      d.up('api');
      await d.run(T + 60);
    });

    await d.run(T);

    expect(d.lastSent()).toMatchObject({ kind: 'recovered', currentTime: T + 60 });
    expect(d.lastMessage()).toBe(
      '✅ Api is up!\nThe service recovered after 1 minutes of downtime.',
    );
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

  it('lets a late failure from the run that lost its claim leave the newer claim alone', async () => {
    const policy = { gracePeriodSeconds: 0, skipIds: [], skipErrorChanges: false };
    const d = deployment([pull('api')]);
    const failing = { location: 'SFO', result: { ok: false as const, error: 'Unavailable' } };
    const record = (at: number) =>
      d.hub.record(at, [{ monitor: pull('api') as MonitorTarget, check: failing }], policy);
    const outcome = ({ incident, kind, reopenedAt, run }: Alert, delivered: boolean) => ({
      incident,
      kind,
      reopenedAt,
      run,
      delivered,
    });

    const first = record(T).alerts;
    const second = record(T + 20 * 60).alerts;
    expect(second).toMatchObject([{ kind: 'down' }]);

    d.hub.confirmAlerts(first.map((alert) => outcome(alert, false)));
    d.hub.confirmAlerts(second.map((alert) => outcome(alert, true)));

    expect(record(T + 41 * 60).alerts).toEqual([]);
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

  it('alerts through a webhook whose timeout is out of range, with the default timeout', async () => {
    const logged = logErrors();
    const secret = JSON.stringify([
      { url: 'https://one.example.com', timeout: 120_000 },
      { url: 'https://two.example.com', timeout: 0 },
    ]);
    const d = deployment([pull('api')], { webhook: [] }, secret);
    d.down('api');

    await d.run(T);

    expect(d.deliveredTo().sort()).toEqual(['one.example.com', 'two.example.com']);
    expect(logged).toHaveLength(2);
    expect(logged.join('\n')).toMatch(/webhook 1\.timeout.*default/);
    expect(logged.join('\n')).toMatch(/webhook 2\.timeout.*default/);
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

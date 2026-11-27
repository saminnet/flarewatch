import { describe, expect, it, vi } from 'vite-plus/test';
import {
  configIssues,
  parseSecretAlertEmails,
  type MonitorTarget,
  type WorkerConfig,
} from '@flarewatch/shared';
import { runChecks, type WorkerDeps } from '../../src/index';
import { plannedAlertChannels } from '../../src/checkers';
import { createNotifier } from '../../src/notifications/webhook';
import { sendAlertEmail, type AlertEmailMessage } from '../../src/notifications/email';
import { createHub, hubNamespace } from '../helpers/hub';
import type { Env } from '../../src/env';

const apiMonitor: MonitorTarget = {
  id: 'api',
  name: 'API',
  method: 'GET',
  target: 'https://api.example.test/health',
  reminderEveryChecks: 30,
};

const dbMonitor: MonitorTarget = {
  id: 'db',
  name: 'Database',
  method: 'TCP_PING',
  target: 'db.example.test:5432',
};

function stubEnv(hub: ReturnType<typeof createHub>['hub'], extra: Env = {}): Env {
  return {
    MONITOR_HUB: hubNamespace(hub),
    ...extra,
  };
}

describe('Cloudflare ALERT_EMAIL operator alerts', () => {
  it('delivers down, error change, and recovery alerts for an email-only monitor', async () => {
    const { hub } = createHub();
    const sent: AlertEmailMessage[] = [];
    const env = stubEnv(hub, {
      ALERT_EMAIL: {
        send: vi.fn(async (msg: AlertEmailMessage) => {
          sent.push(msg);
        }),
      },
    });
    const config: WorkerConfig = {
      monitors: [apiMonitor],
      notification: {
        email: { from: 'alerts@example.test', to: 'ops@example.test' },
      },
    };
    const results = [
      { location: 'FRA', result: { ok: false as const, error: 'HTTP 500', latency: 50 } },
      { location: 'FRA', result: { ok: false as const, error: 'HTTP 503', latency: 50 } },
      { location: 'FRA', result: { ok: true as const, latency: 20 } },
    ];
    let step = 0;
    const deps: WorkerDeps = {
      checkMonitor: async () => results[step++]!,
      createNotifier,
      getEdgeLocation: async () => 'FRA',
      staticConfig: config,
    };

    const t0 = 1_736_942_400_000;
    await runChecks(env, deps, t0);
    await runChecks(env, deps, t0 + 60_000);
    await runChecks(env, deps, t0 + 120_000);

    expect(sent.map((m) => m.subject)).toEqual([
      '🔴 API is down',
      '🔴 API is down',
      '✅ API is up',
    ]);
    expect(sent[0]).toMatchObject({
      from: 'alerts@example.test',
      to: ['ops@example.test'],
    });
    expect(sent[1]!.text).toContain('HTTP 503');
  });

  it('does not mark an email-routed public monitor as delivered when ALERT_EMAIL fails alongside subscribers', async () => {
    const { hub } = createHub();
    const send = vi
      .fn<(msg: AlertEmailMessage) => Promise<void>>()
      .mockRejectedValueOnce(new Error('temporary error'))
      .mockResolvedValueOnce(undefined);
    const env = stubEnv(hub, { ALERT_EMAIL: { send } });
    const config: WorkerConfig = {
      monitors: [apiMonitor],
      notification: {
        email: { from: 'alerts@example.test', to: 'ops@example.test' },
      },
    };
    const deps: WorkerDeps = {
      checkMonitor: async () => ({
        location: 'FRA',
        result: { ok: false as const, error: 'HTTP 500', latency: 50 },
      }),
      createNotifier,
      getEdgeLocation: async () => 'FRA',
      staticConfig: config,
      pageConfig: {
        subscribers: { from: 'status@example.test' },
      },
    };

    const t0 = 1_736_942_400_000;
    await runChecks(env, deps, t0);
    await runChecks(env, deps, t0 + 60_000);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      from: 'alerts@example.test',
      to: ['ops@example.test'],
      subject: '🔴 API is down',
    });
    expect(send.mock.calls[1]?.[0]).toMatchObject({
      from: 'alerts@example.test',
      to: ['ops@example.test'],
      subject: '🔴 API is down',
    });
  });

  it('combines alerts into one summary email when summaryAfter is reached', async () => {
    const { hub } = createHub();
    const sent: AlertEmailMessage[] = [];
    const env = stubEnv(hub, {
      ALERT_EMAIL: {
        send: vi.fn(async (msg: AlertEmailMessage) => {
          sent.push(msg);
        }),
      },
    });
    const config: WorkerConfig = {
      monitors: [apiMonitor, dbMonitor],
      notification: {
        summaryAfter: 2,
        email: { from: 'alerts@example.test', to: 'ops@example.test' },
      },
    };
    const deps: WorkerDeps = {
      checkMonitor: async () => ({
        location: 'FRA',
        result: { ok: false as const, error: 'Timeout', latency: 50 },
      }),
      createNotifier,
      getEdgeLocation: async () => 'FRA',
      staticConfig: config,
    };

    await runChecks(env, deps, 1_736_942_400_000);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe('🔴 FlareWatch (2 alerts) summary');
    expect(sent[0]!.text).toContain('- API');
    expect(sent[0]!.text).toContain('- Database');
  });

  it('returns false and logs a clear message when ALERT_EMAIL binding is missing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = await sendAlertEmail(
      undefined,
      { from: 'alerts@example.test', to: 'ops@example.test' },
      [
        {
          monitor: apiMonitor,
          kind: 'down',
          incidentStartTime: 1_736_942_400,
          currentTime: 1_736_942_400,
          downtimeSeconds: 0,
          reason: 'HTTP 500',
          timeZone: 'UTC',
          alsoDown: [],
        },
      ],
    );
    expect(ok).toBe(false);
    expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('ALERT_EMAIL');
    spy.mockRestore();
  });

  it('redacts recipient and sender addresses from error logs while keeping cause and code visible', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(
      new Error('rejected ops@example.test from alerts@example.test: domain blocked'),
      { code: 'E_SENDER_NOT_VERIFIED' },
    );
    const ok = await sendAlertEmail(
      { send: vi.fn().mockRejectedValue(err) },
      { from: 'alerts@example.test', to: 'ops@example.test' },
      [
        {
          monitor: apiMonitor,
          kind: 'down',
          incidentStartTime: 1_736_942_400,
          currentTime: 1_736_942_400,
          downtimeSeconds: 0,
          reason: 'HTTP 500',
          timeZone: 'UTC',
          alsoDown: [],
        },
      ],
    );
    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(ok).toBe(false);
    expect(logged).toContain('E_SENDER_NOT_VERIFIED');
    expect(logged).toContain('domain blocked');
    expect(logged).not.toContain('ops@example.test');
    expect(logged).not.toContain('alerts@example.test');
    spy.mockRestore();
  });

  it('validates notification.email monitor routing and parses FLAREWATCH_ALERT_EMAILS safely', () => {
    const issues = configIssues({
      monitors: [apiMonitor],
      notification: {
        email: { from: 'alerts@example.test', to: 'ops@example.test', monitors: ['ghost'] },
      },
    });
    expect(issues.join('\n')).toContain('no monitor has id "ghost"');

    const parsed = parseSecretAlertEmails(
      JSON.stringify([
        {
          from: 'alerts@example.test',
          to: 'ops@example.test',
          monitors: ['api', 'secret-missing-id'],
          extraSecretField: 'do-not-leak',
        },
        { from: 'bad', to: 'not-an-email' },
      ]),
      ['api'],
    );
    expect(parsed.emails).toEqual([
      { from: 'alerts@example.test', to: 'ops@example.test', monitors: ['api'] },
    ]);
    expect(parsed.issues.join('\n')).not.toContain('secret-missing-id');
    expect(parsed.issues.join('\n')).not.toContain('do-not-leak');
    expect(parsed.issues.join('\n')).not.toContain('extraSecretField');
  });

  it('caps plannedAlertChannels so secret channels cannot starve checks and rejects malformed from', () => {
    const httpMonitors = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `m-${i}`,
        name: `M ${i}`,
        method: 'GET' as const,
        target: `https://m${i}.example.com`,
      }));
    const domainMonitor = {
      id: 'dom',
      name: 'Domain',
      method: 'DOMAIN' as const,
      target: 'example.com',
    };
    expect(plannedAlertChannels(httpMonitors(5), 50, 0)).toBe(42);
    expect(plannedAlertChannels(httpMonitors(40), 50, 0)).toBe(24);
    expect(plannedAlertChannels([domainMonitor], 46, 0)).toBe(45);
    expect(
      configIssues({
        monitors: [apiMonitor],
        notification: { email: { from: 'alerts@@example.test', to: 'ops@example.test' } },
      }).length,
    ).toBeGreaterThan(0);
  });

  it('delivers alerts configured via FLAREWATCH_ALERT_EMAILS and routes mixed webhook/email channels independently', async () => {
    const { hub } = createHub();
    const sentEmails: AlertEmailMessage[] = [];
    const sentWebhooks: string[] = [];
    const env = stubEnv(hub, {
      ALERT_EMAIL: {
        send: vi.fn(async (msg: AlertEmailMessage) => {
          sentEmails.push(msg);
        }),
      },
      FLAREWATCH_ALERT_EMAILS: JSON.stringify([
        { from: 'alerts@example.test', to: 'db-ops@example.test', monitors: ['db'] },
      ]),
    });
    const config: WorkerConfig = {
      monitors: [apiMonitor, dbMonitor],
      notification: {
        webhook: { url: 'https://hooks.example.test/api', template: 'text', monitors: ['api'] },
      },
    };
    const deps: WorkerDeps = {
      checkMonitor: async () => ({
        location: 'FRA',
        result: { ok: false as const, error: 'Timeout', latency: 50 },
      }),
      createNotifier: (cfg) =>
        createNotifier(cfg, async (url) => {
          sentWebhooks.push(url);
          return new Response('ok', { status: 200 });
        }),
      getEdgeLocation: async () => 'FRA',
      staticConfig: config,
    };

    await runChecks(env, deps, 1_736_942_400_000);

    expect(sentWebhooks).toEqual(['https://hooks.example.test/api']);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toMatchObject({
      from: 'alerts@example.test',
      to: ['db-ops@example.test'],
      subject: '🔴 Database is down',
    });
  });

  it('bounds sendAlertEmail when a timeout is provided', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const never = new Promise<void>(() => {});
    const ok = await sendAlertEmail(
      { send: vi.fn().mockReturnValue(never) },
      { from: 'alerts@example.test', to: 'ops@example.test' },
      [
        {
          monitor: apiMonitor,
          kind: 'down',
          incidentStartTime: 1_736_942_400,
          currentTime: 1_736_942_400,
          downtimeSeconds: 0,
          reason: 'HTTP 500',
          timeZone: 'UTC',
          alsoDown: [],
        },
      ],
      20,
    );
    expect(ok).toBe(false);
    expect(spy.mock.calls.map((c) => String(c[0])).join('\n')).toContain('timed out');
    spy.mockRestore();
  });

  it('keeps total check and alert subrequests within the 50-subrequest limit with 30 channels', async () => {
    const { hub } = createHub();
    const domainMonitors: MonitorTarget[] = Array.from({ length: 3 }, (_, i) => ({
      id: `dom-${i}`,
      name: `Domain ${i}`,
      method: 'DOMAIN',
      target: `d${i}.example.test`,
      checkEveryMinutes: 1,
    }));
    const emails = Array.from({ length: 30 }, (_, i) => ({
      from: 'alerts@example.test',
      to: `ops${i}@example.test`,
    }));
    let checked = 0;
    let sent = 0;
    const env = stubEnv(hub, {
      ALERT_EMAIL: {
        send: vi.fn(async () => {
          sent++;
        }),
      },
    });
    const deps: WorkerDeps = {
      checkMonitor: async () => {
        checked++;
        return { location: 'FRA', result: { ok: false as const, error: 'Expired', latency: 10 } };
      },
      createNotifier,
      getEdgeLocation: async () => 'FRA',
      staticConfig: { monitors: domainMonitors, notification: { email: emails } },
    };

    await runChecks(env, deps, 1_736_942_400_000);

    expect(checked).toBeGreaterThan(0);
    // 3 reserved for hub + 2 per DOMAIN check + 1 per email send must stay <= 50.
    expect(3 + checked * 2 + sent).toBeLessThanOrEqual(50);
  });
});

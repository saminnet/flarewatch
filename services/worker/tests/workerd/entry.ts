import { runChecks } from '../../src/index';
import { createNotifier } from '../../src/notifications/webhook';
import * as z from 'zod/mini';
import { Subscribers, drainSubscribers } from '../../src/hub/subscribers';
import { durableObjectSql } from '../../src/hub/sql';
import type { Monitor, PageConfig } from '@flarewatch/shared';
import type { SubscriberMessage } from '../../src/notifications/subscriber-sender';
import type { Env } from '../../src/env';
import type { AlertPolicy } from '../../src/hub/alerts';
import { MonitorHub as Hub, type CheckRecord } from '../../src/hub/monitor-hub';
import { handleHubRequest } from '../../src/hub/routes';

/** Rows read and written as Durable Objects bill them. */
export interface Rows {
  read: number;
  written: number;
}

/** The hub, counting the rows its statements read and write as Durable Objects bill them. */
export class MonitorHub extends Hub {
  private readonly mail: SubscriberMessage[] = [];
  private readonly cursors: SqlStorageCursor<Record<string, SqlStorageValue>>[];
  /** What the constructor cost, migrations included, until startupRows() hands it out. */
  private startup: Rows | null;

  constructor(ctx: DurableObjectState, env: Env) {
    const { sql } = ctx.storage;
    const cursors: SqlStorageCursor<Record<string, SqlStorageValue>>[] = [];
    let migrated = false;
    Object.defineProperty(ctx.storage, 'sql', {
      value: {
        exec: (query: string, ...bindings: unknown[]) => {
          if (migrated && query.includes('incidents')) {
            const plan = sql.exec(`EXPLAIN QUERY PLAN ${query}`, ...bindings).toArray();
            if (
              plan.some(
                ({ detail }) => typeof detail === 'string' && /^SCAN incidents\b/.test(detail),
              )
            ) {
              throw new Error(`Query scans every incident: ${query}`);
            }
          }
          const cursor = sql.exec(query, ...bindings);
          cursors.push(cursor);
          return cursor;
        },
      },
    });
    const mail: SubscriberMessage[] = [];
    super(ctx, {
      ...env,
      SUBSCRIBER_EMAIL: {
        async send(message) {
          mail.push(message);
        },
      },
      SUBSCRIBER_SECRET: 'test-secret',
      PUBLIC_ORIGIN: 'https://status.example.com',
    });
    this.mail = mail;
    migrated = true;
    this.startup = sum(cursors.splice(0));
    this.cursors = cursors;
  }

  async testAlarm() {
    await super.alarm();
    return this.mail.splice(0);
  }

  async testDrain(
    now: number,
    cap: number,
    monitors: Monitor[],
    remove: string,
    fail: boolean,
    rollover = false,
    cloudflare = false,
  ) {
    let time = now;
    const sent: { key: string | null; recipients: string[]; text: string[] }[] = [];
    const network: typeof fetch = async (input, init) => {
      if (input !== 'https://api.resend.com/emails/batch')
        throw new Error('Unexpected network request');
      if (fail) throw new Error('Connection lost');
      const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '');
      const messages = z.array(z.object({ to: z.array(z.string()), text: z.string() })).parse(body);
      sent.push({
        key: new Headers(init?.headers).get('Idempotency-Key'),
        recipients: messages.flatMap(({ to }) => to),
        text: messages.map(({ text }) => text),
      });
      if (sent.length === 1 && remove) this.unsubscribe(remove);
      if (sent.length === 1 && rollover) time += 86400;
      return Response.json({ data: messages.map((_, index) => ({ id: `mail-${index}` })) });
    };
    await drainSubscribers(
      new Subscribers(durableObjectSql(this.ctx.storage)),
      durableObjectSql(this.ctx.storage),
      this.ctx.storage,
      {
        from: 'status@example.com',
        dailySendCap: cap,
        provider: cloudflare ? 'cloudflare' : 'resend',
      },
      monitors,
      {
        ...this.env,
        RESEND_API_KEY: 'test-key',
        SUBSCRIBER_EMAIL: {
          async send(message) {
            sent.push({ key: null, recipients: message.to, text: [message.text] });
            if (sent.length === 1 && rollover) time += 86400;
          },
        },
      },
      () => time,
      network,
    );
    return sent;
  }

  /** Rows read and written since the last call. */
  rows(): Rows {
    return sum(this.cursors.splice(0));
  }

  /** The constructor's rows on the first call after the object starts, then null. */
  startupRows(): Rows | null {
    const { startup } = this;
    this.startup = null;
    return startup;
  }
}

/** A cursor counts the rows it has stepped through. */
function sum(cursors: SqlStorageCursor<Record<string, SqlStorageValue>>[]): Rows {
  const rows: Rows = { read: 0, written: 0 };
  for (const cursor of cursors) {
    rows.read += cursor.rowsRead;
    rows.written += cursor.rowsWritten;
  }
  return rows;
}

/** One check run for POST /record. */
export interface Run {
  now: number;
  records: CheckRecord[];
  policy?: AlertPolicy;
  subscribers?: boolean;
  page?: Pick<PageConfig, 'subscribers' | 'visibility'>;
}

type Stub = DurableObjectStub<MonitorHub>;

/**
 * Responds with the result of `operation` and the rows its hub calls cost. When
 * this request started the object, it also sends the constructor's rows; the
 * statements miniflare runs after the constructor are left out.
 */
async function measured<T>(hub: Stub, operation: () => Promise<T>): Promise<Response> {
  const startup = await hub.startupRows();
  await hub.rows();
  const result = await operation();
  const { read, written } = await hub.rows();
  const headers = new Headers({ 'rows-read': String(read), 'rows-written': String(written) });
  if (startup) {
    headers.set('startup-rows-read', String(startup.read));
    headers.set('startup-rows-written', String(startup.written));
  }
  return Response.json(result, { headers });
}

async function record(hub: Stub, runs: Run[]) {
  const results = [];
  for (const { now, records, policy, subscribers, page } of runs)
    results.push(await hub.record(now, records, policy, subscribers, page));
  return results;
}

/** Runs as runChecks does with every webhook accepting: record, then report each alert delivered. */
async function alert(hub: Stub, runs: Run[]) {
  const results = [];
  for (const { now, records, policy, subscribers, page } of runs) {
    const { alerts } = await hub.record(now, records, policy, subscribers, page);
    if (alerts.length > 0) {
      await hub.confirmAlerts(
        alerts.map(({ monitorId, incident, kind, reopenedAt, run }) => ({
          monitorId,
          incident,
          kind,
          reopenedAt,
          run,
          delivered: true,
        })),
      );
    }
    results.push(alerts.map(({ monitorId, kind }) => `${monitorId} ${kind}`));
  }
  return results;
}

export default {
  async fetch(request: Request, env: { MONITOR_HUB: DurableObjectNamespace<MonitorHub> }) {
    const url = new URL(request.url);
    const hub = env.MONITOR_HUB.getByName(url.searchParams.get('hub') ?? 'hub');
    if (url.pathname.startsWith('/announcements')) {
      return (await handleHubRequest(request, env)) ?? new Response(null, { status: 404 });
    }
    switch (url.pathname) {
      case '/ack':
        return measured(hub, () =>
          hub.ackIncident(
            url.searchParams.get('id') ?? '',
            url.searchParams.get('by') ?? 'operator',
          ),
        );
      case '/subscriber-alarm':
        return measured(hub, () => hub.testAlarm());
      case '/subscriber-check': {
        const runs: Run[] = await request.json();
        const records = runs[0]?.records ?? [];
        return measured(hub, async () => {
          await runChecks(env, {
            staticConfig: {
              monitors: records.map(({ monitor }) => monitor),
              notification: {
                gracePeriod: 0,
                webhook: { url: 'https://hooks.example.com', monitors: ['a'] },
              },
            },
            pageConfig: runs[0]?.page ?? { subscribers: { from: 'status@example.com' } },
            getEdgeLocation: async () => 'HEL',
            createNotifier: (config) => createNotifier(config, async () => new Response('ok')),
            checkMonitor: async (monitor) => {
              const record = records.find((record) => record.monitor.id === monitor.id);
              if (!record || !('check' in record) || !record.check)
                throw new Error('Missing check result');
              return record.check;
            },
          });
          return Math.floor(Date.now() / 1000);
        });
      }
      case '/subscriber-action': {
        const action = url.searchParams.get('action');
        const email = url.searchParams.get('email') ?? 'person@example.com';
        const now = Number(url.searchParams.get('now'));
        return measured(hub, async () => {
          if (action === 'subscribe')
            return hub.subscribe(email, now, Number(url.searchParams.get('max') ?? 200));
          if (action === 'confirm')
            return hub.confirmSubscriber(email, url.searchParams.get('generation') ?? '1', now);
          if (action === 'unsubscribe') {
            await hub.unsubscribe(email);
            return true;
          }
          return hub.subscriberCount();
        });
      }
      case '/subscriber-drain': {
        const records: Run[] = await request.json();
        return measured(hub, () =>
          hub.testDrain(
            Number(url.searchParams.get('now')),
            Number(url.searchParams.get('cap')),
            records[0]?.records.map(({ monitor }) => monitor) ?? [],
            url.searchParams.get('remove') ?? '',
            url.searchParams.get('fail') === 'true',
            url.searchParams.get('rollover') === 'true',
            url.searchParams.get('provider') === 'cloudflare',
          ),
        );
      }
      case '/view':
        return measured(hub, () => hub.view());
      case '/latency': {
        const id = url.searchParams.get('id') ?? '';
        const now = Number(url.searchParams.get('now'));
        return measured(hub, () => hub.latency(id, now));
      }
      case '/record': {
        const runs: Run[] = await request.json();
        return measured(hub, () => record(hub, runs));
      }
      case '/alert': {
        const runs: Run[] = await request.json();
        return measured(hub, () => alert(hub, runs));
      }
      default:
        return new Response(null, { status: 404 });
    }
  },
};

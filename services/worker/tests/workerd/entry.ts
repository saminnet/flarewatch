import type { Env } from '../../src/env';
import type { AlertPolicy } from '../../src/hub/alerts';
import { MonitorHub as Hub, type CheckRecord } from '../../src/hub/monitor-hub';

/** Rows read and written as Durable Objects bill them. */
export interface Rows {
  read: number;
  written: number;
}

/** The hub, counting the rows its statements read and write as Durable Objects bill them. */
export class MonitorHub extends Hub {
  private readonly cursors: SqlStorageCursor<Record<string, SqlStorageValue>>[];
  /** What the constructor cost, migrations included, until startupRows() hands it out. */
  private startup: Rows | null;

  constructor(ctx: DurableObjectState, env: Env) {
    const { sql } = ctx.storage;
    const cursors: SqlStorageCursor<Record<string, SqlStorageValue>>[] = [];
    Object.defineProperty(ctx.storage, 'sql', {
      value: {
        exec: (query: string, ...bindings: unknown[]) => {
          const cursor = sql.exec(query, ...bindings);
          cursors.push(cursor);
          return cursor;
        },
      },
    });
    super(ctx, env);
    this.startup = sum(cursors.splice(0));
    this.cursors = cursors;
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
  for (const { now, records, policy } of runs) results.push(await hub.record(now, records, policy));
  return results;
}

/** Runs as runChecks does with every webhook accepting: record, then report each alert delivered. */
async function alert(hub: Stub, runs: Run[]) {
  const results = [];
  for (const { now, records, policy } of runs) {
    const { alerts } = await hub.record(now, records, policy);
    for (let batch = alerts; batch.length > 0;) {
      batch = await hub.confirmAlerts(
        batch.map(({ incident, kind, reopenedAt, run }) => ({
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
    switch (url.pathname) {
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

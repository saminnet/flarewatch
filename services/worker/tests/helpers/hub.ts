import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Env } from '../../src/env';
import { MonitorHub } from '../../src/hub/monitor-hub';

/** Durable Object storage over an in-memory node:sqlite database. */
function createStorage(db: DatabaseSync, onQuery: (query: string) => void) {
  return {
    sql: {
      exec: (query: string, ...bindings: SQLInputValue[]) => {
        onQuery(query);
        const rows = db.prepare(query).all(...bindings);
        return { toArray: () => rows };
      },
    },
    transactionSync<T>(fn: () => T): T {
      db.exec('SAVEPOINT tx');
      try {
        const result = fn();
        db.exec('RELEASE tx');
        return result;
      } catch (error) {
        db.exec('ROLLBACK TO tx');
        db.exec('RELEASE tx');
        throw error;
      }
    },
  };
}

/**
 * Past migrations, a query that would scan every incident fails the test, as
 * when it loses its index. The workerd tests measure the rows Durable Objects bill.
 */
export function createHub(env: Env = {}, db = new DatabaseSync(':memory:')) {
  let migrated = false;
  const ctx = {
    storage: createStorage(db, (query) => {
      const plan = migrated ? db.prepare(`EXPLAIN QUERY PLAN ${query}`).all() : [];
      if (plan.some(({ detail }) => /^SCAN incidents\b/.test(String(detail)))) {
        throw new Error(`Query scans every incident: ${query}`);
      }
    }),
  };
  // SAFETY: the hub touches only ctx.storage.sql.exec and ctx.storage.transactionSync,
  // which the fake implements.
  const hub = new MonitorHub(ctx as typeof ctx & DurableObjectState, env);
  migrated = true;
  return { hub, db };
}

/** A namespace whose every name resolves to this hub, standing in for the MONITOR_HUB binding. */
export function hubNamespace(hub: MonitorHub): DurableObjectNamespace<MonitorHub> {
  const namespace = { getByName: () => hub };
  // SAFETY: the worker only calls getByName, and awaiting the hub's synchronous
  // methods gives the same values an RPC stub resolves to.
  return namespace as typeof namespace & DurableObjectNamespace<MonitorHub>;
}

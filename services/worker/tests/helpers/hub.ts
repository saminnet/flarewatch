import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Env } from '../../src/env';
import { MonitorHub } from '../../src/hub/monitor-hub';

/** Durable Object storage over an in-memory node:sqlite database. */
function createStorage(db: DatabaseSync) {
  return {
    sql: {
      exec: (query: string, ...bindings: SQLInputValue[]) => {
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

export function createHub(env: Env = {}, db = new DatabaseSync(':memory:')) {
  let ready: Promise<unknown> = Promise.resolve();
  const ctx = {
    storage: createStorage(db),
    blockConcurrencyWhile: <T>(fn: () => Promise<T>) => {
      const result = fn();
      ready = result;
      return result;
    },
  };
  // SAFETY: the hub touches only ctx.storage.sql.exec, ctx.storage.transactionSync
  // and ctx.blockConcurrencyWhile, which the fake implements.
  const hub = new MonitorHub(ctx as typeof ctx & DurableObjectState, env);
  // The runtime holds requests until blockConcurrencyWhile settles; tests await this instead.
  return { hub, db, ready: () => ready };
}

/** Rows inserted, updated or deleted on db since it opened. */
export function rowsWritten(db: DatabaseSync): number {
  const row = db.prepare('SELECT total_changes() AS n').get();
  return Number(row?.n);
}

/** A namespace whose every name resolves to this hub, standing in for the MONITOR_HUB binding. */
export function hubNamespace(hub: MonitorHub): DurableObjectNamespace<MonitorHub> {
  const namespace = { getByName: () => hub };
  // SAFETY: the worker only calls getByName, and awaiting the hub's synchronous
  // methods gives the same values an RPC stub resolves to.
  return namespace as typeof namespace & DurableObjectNamespace<MonitorHub>;
}

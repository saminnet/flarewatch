import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterAll, expect, onTestFinished } from 'vite-plus/test';
import { MonitorHub } from '../../src/hub/monitor-hub';

/** Durable Object storage over an in-memory node:sqlite database. */
function createStorage(db: DatabaseSync, onQuery: (query: string) => void) {
  return {
    sql: {
      exec: (query: string, ...bindings: SQLInputValue[]) => {
        let statement = db.prepare(query);
        let rest = query.slice(statement.sourceSQL.length).trim();
        while (rest) {
          onQuery(statement.sourceSQL);
          statement.run();
          query = rest;
          statement = db.prepare(query);
          rest = query.slice(statement.sourceSQL.length).trim();
        }
        onQuery(statement.sourceSQL);
        const rows = statement.all(...bindings);
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

const owned = new WeakSet<DatabaseSync>();

/** Closes `db` when the test that opened it ends, or after the file when no test is running. */
function own(db: DatabaseSync): void {
  if (owned.has(db)) return;
  owned.add(db);
  const close = () => {
    if (db.isOpen) db.close();
  };
  if (expect.getState().currentTestName === undefined) afterAll(close);
  else onTestFinished(close);
}

/**
 * Past migrations, a query that would scan every incident fails the test, as
 * when it loses its index. The workerd tests measure the rows Durable Objects bill.
 * A hub reopened over the same `db` shares its owner.
 */
export function createHub(db = new DatabaseSync(':memory:')) {
  own(db);
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
  const hub = new MonitorHub(ctx as typeof ctx & DurableObjectState, {});
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

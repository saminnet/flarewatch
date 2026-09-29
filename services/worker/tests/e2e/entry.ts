import fixture from '@flarewatch/e2e-hub-fixture';
import type { Env } from '../../src/env';
import { MonitorHub as Hub } from '../../src/hub/monitor-hub';
import type { HubFixture } from './hub-fixture';

export { default } from '../../src/index';

// Worker entry for the browser tests: the real Worker, with a hub that starts from the seed fixture.
export class MonitorHub extends Hub {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const { sql } = ctx.storage;
    if (sql.exec('SELECT 1 FROM monitors LIMIT 1').toArray().length === 0) {
      ctx.storage.transactionSync(() => seed(sql, fixture));
    }
  }
}

function seed(sql: SqlStorage, f: HubFixture): void {
  for (const id of new Set([...Object.keys(f.startedAt), ...Object.keys(f.heartbeats)])) {
    const heartbeat = f.heartbeats[id];
    sql.exec(
      'INSERT INTO monitors (id, started_at, heartbeat) VALUES (?, ?, ?)',
      id,
      f.startedAt[id] ?? null,
      heartbeat ? JSON.stringify(heartbeat) : null,
    );
  }
  for (const [id, incidents] of Object.entries(f.incidents)) {
    for (const { start, error, end } of incidents) {
      sql.exec(
        "INSERT INTO incidents (monitor_id, starts, errors, end_at, alert) VALUES (?, ?, ?, ?, 'silent')",
        id,
        JSON.stringify(start),
        JSON.stringify(error),
        end ?? null,
      );
    }
  }
  const samples = new Map<number, Record<string, [number, string]>>();
  for (const [id, recent] of Object.entries(f.latency)) {
    for (const { time, ping, loc } of recent) {
      samples.set(time, { ...samples.get(time), [id]: [ping, loc] });
    }
  }
  for (const [at, data] of samples) {
    sql.exec('INSERT INTO samples (at, data) VALUES (?, ?)', at, JSON.stringify(data));
  }
  for (const maintenance of f.maintenances) {
    sql.exec(
      'INSERT INTO maintenances (id, data) VALUES (?, ?)',
      maintenance.id,
      JSON.stringify(maintenance),
    );
  }
  sql.exec("INSERT INTO meta (key, value) VALUES ('last_update', ?)", String(f.lastUpdate));
}

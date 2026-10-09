import { Incidents } from './incidents';
import type { Sql } from './sql';
import { parseJson } from './sql';
import * as z from 'zod/mini';
import type { LatencySample } from '@flarewatch/shared';

const hourSchema = z.record(z.string(), z.record(z.string(), z.tuple([z.number(), z.string()])));
const latestSchema = z.record(
  z.string(),
  z.object({ ping: z.number(), loc: z.string(), time: z.number() }),
);

export function parseHour(data: string | null) {
  return hourSchema.safeParse(parseJson(data)).data ?? {};
}

export function parseLatest(data: string | null) {
  return latestSchema.safeParse(parseJson(data)).data ?? {};
}

// Durable Object SQLite has no PRAGMA user_version, so applied steps are rows
// in _migrations. Append new steps; never edit a shipped one.
const MIGRATIONS: (string | ((sql: Sql) => void))[][] = [
  [
    `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID`,
    `CREATE TABLE monitors (
      id TEXT PRIMARY KEY,
      started_at INTEGER,
      heartbeat TEXT
    ) WITHOUT ROWID`,
    `CREATE TABLE incidents (
      id INTEGER PRIMARY KEY,
      monitor_id TEXT NOT NULL,
      starts TEXT NOT NULL,
      errors TEXT NOT NULL,
      end_at INTEGER
    )`,
    // One row per check run holding every monitor's sample, not one row per
    // monitor: the free plan allows 100,000 rows written a day.
    `CREATE TABLE samples (at INTEGER PRIMARY KEY, data TEXT NOT NULL)`,
  ],
  [`CREATE TABLE maintenances (id TEXT PRIMARY KEY, data TEXT NOT NULL) WITHOUT ROWID`],
  // Whether the incident's down alert reached a webhook: 'pending', 'sending'
  // (claimed by a run at alert_claimed_at), 'sent', 'failed' (gave up after
  // repeated failed deliveries) or 'silent' (never alert). Earlier releases
  // kept no record, so their incidents go silent.
  [
    `ALTER TABLE incidents ADD COLUMN alert TEXT NOT NULL DEFAULT 'pending'`,
    `ALTER TABLE incidents ADD COLUMN alert_attempts INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE incidents ADD COLUMN alert_claimed_at INTEGER`,
    `UPDATE incidents SET alert = 'silent'`,
  ],
  // Bookkeeping from the 1.x import, which 3.0 removed.
  [`DELETE FROM meta WHERE key IN ('v1_import', 'v1_import_marked')`],
  // When a flap last reopened the incident, where its grace period restarts,
  // and how many error-change alerts it has sent.
  [
    `ALTER TABLE incidents ADD COLUMN reopened_at INTEGER`,
    `ALTER TABLE incidents ADD COLUMN error_alerts INTEGER NOT NULL DEFAULT 0`,
  ],
  // Check runs look up open, expired and one monitor's incidents. Without these
  // each lookup reads the whole history, and the free plan allows 5 million rows read a day.
  [
    `CREATE INDEX incidents_end_at ON incidents (end_at)`,
    `CREATE INDEX incidents_monitor_end ON incidents (monitor_id, end_at)`,
  ],
  // Moves what 3.1.0 kept into the new tables once: the last 12 hours of
  // samples, skipping an hour over 1.9 MB, and every incident into the lists.
  // The bound dates from the docs' 2 MB row limit; the measured limit is 8 MB,
  // but a shipped step never changes.
  [
    `CREATE TABLE incident_lists (
      monitor_id TEXT NOT NULL,
      part INTEGER NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (monitor_id, part)
    ) WITHOUT ROWID`,
    `ALTER TABLE incidents ADD COLUMN up_since INTEGER`,
    `CREATE TABLE latency (hour INTEGER PRIMARY KEY, data TEXT NOT NULL)`,
    // The size filter is a subquery: in HAVING it would run after json_group_object
    // had built the oversized value and failed on the string limit.
    `INSERT INTO latency (hour, data)
     SELECT at / 3600, json_group_object(CAST(at AS TEXT), json(data)) FROM samples
     WHERE json_valid(data) AND at >= (SELECT MAX(at) FROM samples) - 12 * 3600
       AND at / 3600 IN (SELECT at / 3600 FROM samples GROUP BY at / 3600
                         HAVING SUM(LENGTH(CAST(data AS BLOB)) + 16) <= 1900000)
     GROUP BY at / 3600`,
    `DELETE FROM samples`,
    (sql) => new Incidents(sql).importHistory(),
  ],
  // Reminders count check runs. The run count rides on the row every run already
  // writes; alert_run is the run that claimed the incident's last notice, and
  // reminders how many reminders reached a webhook. An outage alerted before
  // this step has no alert_run and counts from the step's first run.
  [
    `ALTER TABLE meta ADD COLUMN runs INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE incidents ADD COLUMN alert_run INTEGER`,
    `ALTER TABLE incidents ADD COLUMN reminders INTEGER NOT NULL DEFAULT 0`,
  ],
  [
    `ALTER TABLE monitors ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE monitors ADD COLUMN first_failure_at INTEGER`,
  ],
  [
    `ALTER TABLE monitors ADD COLUMN warning TEXT`,
    `CREATE TABLE expiry_alerts (
      monitor_id TEXT NOT NULL,
      expiry_date INTEGER NOT NULL,
      run INTEGER NOT NULL,
      PRIMARY KEY (monitor_id, expiry_date)
    ) WITHOUT ROWID`,
  ],
  [`CREATE TABLE announcements (id TEXT PRIMARY KEY, data TEXT NOT NULL) WITHOUT ROWID`],
  [
    `ALTER TABLE meta ADD COLUMN latest TEXT NOT NULL DEFAULT '{}'`,
    (sql) => {
      const ids = new Set(sql.exec<{ id: string }>('SELECT id FROM monitors').map(({ id }) => id));
      const latest = new Map<string, LatencySample>();
      const [newest] = sql.exec<{ hour: number }>(
        'SELECT hour FROM latency ORDER BY hour DESC LIMIT 1',
      );
      if (!newest) return;
      let before = newest.hour + 1;
      for (;;) {
        const [hour] = sql.exec<{ hour: number; data: string }>(
          'SELECT hour, data FROM latency WHERE hour < ? AND hour >= ? ORDER BY hour DESC LIMIT 1',
          before,
          newest.hour - 12,
        );
        if (!hour) break;
        for (const [at, samples] of Object.entries(parseHour(hour.data)).sort(
          ([a], [b]) => Number(b) - Number(a),
        )) {
          for (const [id, [ping, loc]] of Object.entries(samples)) {
            if (ids.has(id) && !latest.has(id)) latest.set(id, { ping, loc, time: Number(at) });
          }
        }
        before = hour.hour;
      }
      sql.exec(
        "UPDATE meta SET latest = ? WHERE key = 'last_update'",
        JSON.stringify(Object.fromEntries(latest)),
      );
    },
  ],
  [
    `CREATE TABLE pending_recoveries (
      monitor_id TEXT PRIMARY KEY,
      incident INTEGER NOT NULL,
      reopened_at INTEGER,
      start INTEGER NOT NULL,
      at INTEGER NOT NULL,
      claimed_run INTEGER,
      claimed_at INTEGER
    ) WITHOUT ROWID`,
  ],
];

export function migrate(sql: Sql): void {
  sql.exec('CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY)');
  const [row] = sql.exec<{ version: number }>(
    'SELECT COALESCE(MAX(id), 0) AS version FROM _migrations',
  );
  for (let id = (row?.version ?? 0) + 1; id <= MIGRATIONS.length; id++) {
    sql.transaction(() => {
      for (const step of MIGRATIONS[id - 1] ?? []) {
        if (typeof step === 'string') sql.exec(step);
        else step(sql);
      }
      sql.exec('INSERT INTO _migrations (id) VALUES (?)', id);
    });
  }
}

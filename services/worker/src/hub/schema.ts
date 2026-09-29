import type { Sql } from './sql';

// Durable Object SQLite has no PRAGMA user_version, so applied steps are rows
// in _migrations. Append new steps; never edit a shipped one.
const MIGRATIONS: string[][] = [
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
];

export function migrate(sql: Sql): void {
  sql.exec('CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY)');
  const [row] = sql.exec<{ version: number }>(
    'SELECT COALESCE(MAX(id), 0) AS version FROM _migrations',
  );
  for (let id = (row?.version ?? 0) + 1; id <= MIGRATIONS.length; id++) {
    sql.transaction(() => {
      for (const statement of MIGRATIONS[id - 1] ?? []) sql.exec(statement);
      sql.exec('INSERT INTO _migrations (id) VALUES (?)', id);
    });
  }
}

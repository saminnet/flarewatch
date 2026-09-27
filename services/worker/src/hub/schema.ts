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

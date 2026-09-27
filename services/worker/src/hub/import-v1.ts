import {
  createLogger,
  isMonitorState,
  parseHeartbeatSignal,
  parseMaintenances,
  type HeartbeatSignal,
  type Maintenance,
  type MonitorState,
} from '@flarewatch/shared';
import type { Sql } from './sql';

// FlareWatch 1.x kept monitor state in KV. This module copies it into the hub
// once and leaves the KV keys untouched, so redeploying 1.x still works. Delete
// it, and the FLAREWATCH_STATE read, once upgrades no longer come from 1.x.

const log = createLogger('ImportV1');

const DONE_KEY = 'v1_import';
const STATE_KEY = 'state';
const MAINTENANCES_KEY = 'maintenances';
const SIGNAL_PREFIX = 'hb:v1:';

type V1Data = {
  state: MonitorState | null;
  signals: Map<string, HeartbeatSignal>;
  maintenances: Maintenance[];
};

async function readV1(kv: KVNamespace): Promise<V1Data> {
  const stored = await kv.get(STATE_KEY, 'json');
  const maintenances = parseMaintenances(await kv.get(MAINTENANCES_KEY, 'json'));
  const { keys } = await kv.list({ prefix: SIGNAL_PREFIX });
  const signals = new Map<string, HeartbeatSignal>();
  for (const { name } of keys) {
    const signal = parseHeartbeatSignal(await kv.get(name, 'json'));
    if (signal) signals.set(name.slice(SIGNAL_PREFIX.length), signal);
  }
  return { state: isMonitorState(stored) ? stored : null, signals, maintenances };
}

function write(sql: Sql, { state, signals, maintenances }: V1Data): void {
  for (const maintenance of maintenances) {
    sql.exec(
      'INSERT OR REPLACE INTO maintenances (id, data) VALUES (?, ?)',
      maintenance.id,
      JSON.stringify(maintenance),
    );
  }

  const upsertMonitor = (id: string, column: 'started_at' | 'heartbeat', value: number | string) =>
    sql.exec(
      `INSERT INTO monitors (id, ${column}) VALUES (?, ?)
       ON CONFLICT (id) DO UPDATE SET ${column} = excluded.${column}`,
      id,
      value,
    );

  if (state) {
    for (const [id, startedAt] of Object.entries(state.startedAt)) {
      upsertMonitor(id, 'started_at', startedAt);
    }
    for (const [id, incidents] of Object.entries(state.incident)) {
      for (const incident of incidents) {
        sql.exec(
          'INSERT INTO incidents (monitor_id, starts, errors, end_at) VALUES (?, ?, ?, ?)',
          id,
          JSON.stringify(incident.start),
          JSON.stringify(incident.error),
          incident.end ?? null,
        );
      }
    }
    const samples = new Map<number, Record<string, [number, string]>>();
    for (const [id, { recent }] of Object.entries(state.latency)) {
      for (const { time, ping, loc } of recent) {
        const row = samples.get(time) ?? {};
        row[id] = [ping, loc];
        samples.set(time, row);
      }
    }
    for (const [at, data] of samples) {
      sql.exec('INSERT OR REPLACE INTO samples (at, data) VALUES (?, ?)', at, JSON.stringify(data));
    }
    if (state.lastUpdate > 0) {
      sql.exec(
        `INSERT INTO meta (key, value) VALUES ('last_update', ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        String(state.lastUpdate),
      );
    }
  }

  // The KV signal is the newer copy of the pings; the state blob adds the
  // status, deadline and misses the cron worked out.
  const ids = new Set([...Object.keys(state?.heartbeat ?? {}), ...signals.keys()]);
  for (const id of ids) {
    const { status = 'pending', deadline, misses } = state?.heartbeat?.[id] ?? {};
    upsertMonitor(
      id,
      'heartbeat',
      JSON.stringify({
        ...(signals.get(id) ?? parseHeartbeatSignal(state?.heartbeat?.[id])),
        status,
        ...(deadline !== undefined && { deadline }),
        ...(misses && { misses }),
      }),
    );
  }
}

/** Copies 1.x KV data into an empty hub once. A KV error leaves the import for the next start. */
export async function importV1(sql: Sql, kv: KVNamespace | undefined): Promise<void> {
  if (sql.exec('SELECT 1 FROM meta WHERE key = ?', DONE_KEY).length > 0) return;

  let v1: V1Data = { state: null, signals: new Map(), maintenances: [] };
  if (kv) {
    try {
      v1 = await readV1(kv);
    } catch (error) {
      log.error('Reading 1.x state failed, retrying on next start', { error: String(error) });
      return;
    }
  }

  sql.transaction(() => {
    write(sql, v1);
    sql.exec("INSERT INTO meta (key, value) VALUES (?, '1')", DONE_KEY);
  });
  if (v1.state || v1.signals.size > 0 || v1.maintenances.length > 0) {
    log.info('Imported 1.x state', {
      heartbeats: v1.signals.size,
      maintenances: v1.maintenances.length,
    });
  }
}

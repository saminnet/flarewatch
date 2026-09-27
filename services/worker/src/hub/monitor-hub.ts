import { DurableObject } from 'cloudflare:workers';
import * as z from 'zod/mini';
import {
  HEARTBEAT_RUN_HISTORY,
  parseHeartbeatState,
  type CheckResult,
  type HeartbeatState,
  type Incident,
  type LatencySample,
  type Monitor,
  type MonitorCheckResult,
  type MonitorView,
  type StatusView,
} from '@flarewatch/shared';
import type { Env } from '../env';
import { migrate } from './schema';
import { durableObjectSql, type Sql } from './sql';

const INCIDENT_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const LATENCY_RETENTION_SECONDS = 12 * 60 * 60;

export type CheckRecord = { monitor: Monitor; check: MonitorCheckResult };

export interface IncidentUpdate {
  monitorId: string;
  statusChanged: boolean;
  changeType: 'none' | 'up' | 'down' | 'error';
  isUp: boolean;
  incidentStartTime: number;
  error: string;
}

type MonitorRow = { id: string; started_at: number | null; heartbeat: string | null };
type IncidentRow = {
  id: number;
  monitor_id: string;
  starts: string;
  errors: string;
  end_at: number | null;
};

const startsSchema = z.array(z.number());
const errorsSchema = z.array(z.string());

function parseJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toIncident(row: IncidentRow): Incident {
  return {
    start: startsSchema.safeParse(parseJson(row.starts)).data ?? [],
    error: errorsSchema.safeParse(parseJson(row.errors)).data ?? [],
    ...(row.end_at !== null && { end: row.end_at }),
  };
}

/**
 * While a job stays overdue, one miss is appended per elapsed period, so a
 * long outage shows every skipped run.
 */
function withMisses(
  monitor: Monitor,
  heartbeat: HeartbeatState,
  previous: HeartbeatState | null,
  now: number,
): HeartbeatState {
  const previousMisses = previous?.misses;
  const next: HeartbeatState = previousMisses?.length
    ? { ...heartbeat, misses: previousMisses }
    : heartbeat;
  if (
    monitor.method !== 'HEARTBEAT' ||
    next.status !== 'down' ||
    next.lastFail !== undefined ||
    next.deadline === undefined
  ) {
    return next;
  }

  const period = monitor.periodSeconds;
  const lastMiss = previousMisses?.[previousMisses.length - 1];
  const firstMiss = Math.max(next.deadline, lastMiss === undefined ? -Infinity : lastMiss + period);
  const count = Math.floor((now - firstMiss) / period) + 1;
  if (count <= 0) return next;
  const skipped = Math.max(0, count - HEARTBEAT_RUN_HISTORY);
  const appended = Array.from(
    { length: count - skipped },
    (_, i) => firstMiss + (skipped + i) * period,
  );
  return {
    ...next,
    misses: [...(previousMisses ?? []), ...appended].slice(-HEARTBEAT_RUN_HISTORY),
  };
}

/**
 * The only owner of monitor state: incidents, latency samples and heartbeat
 * state. Check runs record into it and the status page reads from it.
 */
export class MonitorHub extends DurableObject<Env> {
  private readonly sql: Sql;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = durableObjectSql(ctx.storage);
    migrate(this.sql);
  }

  /** Stores one check run and returns the incident change of every monitor with a result. */
  record(now: number, records: CheckRecord[]): IncidentUpdate[] {
    return this.sql.transaction(() => {
      const rows = new Map(
        this.sql
          .exec<MonitorRow>('SELECT id, started_at, heartbeat FROM monitors')
          .map((row) => [row.id, row]),
      );
      const open = new Map(
        this.sql
          .exec<IncidentRow>(
            'SELECT id, monitor_id, starts, errors, end_at FROM incidents WHERE end_at IS NULL',
          )
          .map((row) => [row.monitor_id, { id: row.id, incident: toIncident(row) }]),
      );
      const samples: Record<string, [number, string]> = {};
      const updates: IncidentUpdate[] = [];

      for (const { monitor, check } of records) {
        const row = rows.get(monitor.id);

        if (check.heartbeat) {
          const previous = row?.heartbeat ? parseHeartbeatState(parseJson(row.heartbeat)) : null;
          const heartbeat = JSON.stringify(withMisses(monitor, check.heartbeat, previous, now));
          if (heartbeat !== row?.heartbeat) {
            this.sql.exec(
              `INSERT INTO monitors (id, heartbeat) VALUES (?, ?)
               ON CONFLICT (id) DO UPDATE SET heartbeat = excluded.heartbeat`,
              monitor.id,
              heartbeat,
            );
          }
        }

        const result = check.result;
        if (!result) continue;

        if (!row?.started_at) {
          this.sql.exec(
            `INSERT INTO monitors (id, started_at) VALUES (?, ?)
             ON CONFLICT (id) DO UPDATE SET started_at = excluded.started_at`,
            monitor.id,
            now,
          );
        }
        updates.push(this.applyResult(monitor.id, result, open.get(monitor.id), now));
        if (monitor.method !== 'HEARTBEAT') {
          samples[monitor.id] = [result.latency ?? 0, check.location];
        }
      }

      if (Object.keys(samples).length > 0) {
        this.sql.exec(
          'INSERT OR REPLACE INTO samples (at, data) VALUES (?, ?)',
          now,
          JSON.stringify(samples),
        );
      }
      this.sql.exec('DELETE FROM samples WHERE at < ?', now - LATENCY_RETENTION_SECONDS);
      this.sql.exec('DELETE FROM incidents WHERE end_at < ?', now - INCIDENT_RETENTION_SECONDS);
      this.sql.exec(
        `INSERT INTO meta (key, value) VALUES ('last_update', ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        String(now),
      );
      return updates;
    });
  }

  private applyResult(
    monitorId: string,
    result: CheckResult,
    open: { id: number; incident: Incident } | undefined,
    now: number,
  ): IncidentUpdate {
    const incidentStartTime = open?.incident.start[0] ?? now;

    if (result.ok) {
      if (open) this.sql.exec('UPDATE incidents SET end_at = ? WHERE id = ?', now, open.id);
      return {
        monitorId,
        statusChanged: Boolean(open),
        changeType: open ? 'up' : 'none',
        isUp: true,
        incidentStartTime,
        error: '',
      };
    }

    if (!open) {
      this.sql.exec(
        'INSERT INTO incidents (monitor_id, starts, errors) VALUES (?, ?, ?)',
        monitorId,
        JSON.stringify([now]),
        JSON.stringify([result.error]),
      );
      return {
        monitorId,
        statusChanged: true,
        changeType: 'down',
        isUp: false,
        incidentStartTime: now,
        error: result.error,
      };
    }

    const { incident } = open;
    const changed = incident.error[incident.error.length - 1] !== result.error;
    if (changed) {
      this.sql.exec(
        'UPDATE incidents SET starts = ?, errors = ? WHERE id = ?',
        JSON.stringify([...incident.start, now]),
        JSON.stringify([...incident.error, result.error]),
        open.id,
      );
    }
    return {
      monitorId,
      statusChanged: changed,
      changeType: changed ? 'error' : 'none',
      isUp: false,
      incidentStartTime,
      error: result.error,
    };
  }

  /** Every monitor the hub has seen, with its incidents and latest latency sample. */
  view(): StatusView {
    const [meta] = this.sql.exec<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'last_update'",
    );
    const incidents = new Map<string, Incident[]>();
    for (const row of this.sql.exec<IncidentRow>(
      'SELECT id, monitor_id, starts, errors, end_at FROM incidents ORDER BY id',
    )) {
      const list = incidents.get(row.monitor_id) ?? [];
      list.push(toIncident(row));
      incidents.set(row.monitor_id, list);
    }
    const [sampleRow] = this.sql.exec<{ at: number; data: string }>(
      'SELECT at, data FROM samples ORDER BY at DESC LIMIT 1',
    );
    const latest = sampleSchema.safeParse(parseJson(sampleRow?.data ?? null)).data ?? {};

    const monitors: Record<string, MonitorView> = {};
    for (const row of this.sql.exec<MonitorRow>('SELECT id, started_at, heartbeat FROM monitors')) {
      const list = incidents.get(row.id) ?? [];
      const heartbeat = row.heartbeat ? parseHeartbeatState(parseJson(row.heartbeat)) : null;
      const sample = latest[row.id];
      const down = list[list.length - 1]?.end === undefined && list.length > 0;
      monitors[row.id] = {
        status: down ? 'down' : (heartbeat?.status ?? 'up'),
        incidents: list,
        ...(row.started_at !== null && { startedAt: row.started_at }),
        ...(sample &&
          sampleRow && { latest: { ping: sample[0], loc: sample[1], time: sampleRow.at } }),
        ...(heartbeat && { heartbeat }),
      };
    }

    return { lastUpdate: meta ? Number(meta.value) : 0, monitors };
  }

  /** One monitor's latency samples, oldest first. */
  latency(monitorId: string): LatencySample[] {
    return this.sql
      .exec<{ at: number; ping: number | null; loc: string | null }>(
        `SELECT s.at, json_extract(j.value, '$[0]') AS ping, json_extract(j.value, '$[1]') AS loc
         FROM samples s, json_each(s.data) j WHERE j.key = ? ORDER BY s.at`,
        monitorId,
      )
      .flatMap(({ at, ping, loc }) =>
        typeof ping === 'number' && typeof loc === 'string' ? [{ ping, loc, time: at }] : [],
      );
  }
}

const sampleSchema = z.record(z.string(), z.tuple([z.number(), z.string()]));

import { DurableObject } from 'cloudflare:workers';
import * as z from 'zod/mini';
import {
  coversMonitor,
  isMaintenanceActive,
  parseHeartbeatSignal,
  parseMaintenances,
  type Maintenance,
  parseHeartbeatState,
  type CheckResult,
  type CheckResultWithLocation,
  type HeartbeatMonitor,
  type HeartbeatState,
  type Incident,
  type LatencySample,
  type MonitorTarget,
  type MonitorView,
  type HubView,
} from '@flarewatch/shared';
import type { Env } from '../env';
import { applyPing, evaluateHeartbeat, withMisses, type PingKind } from './heartbeat';
import { capSegments } from './incident-segments';
import { importV1 } from './import-v1';
import { migrate } from './schema';
import { durableObjectSql, type Sql } from './sql';

const INCIDENT_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const LATENCY_RETENTION_SECONDS = 12 * 60 * 60;

/** A check monitor's result, or a heartbeat monitor, which the hub evaluates from its pings. */
export type CheckRecord =
  | { monitor: MonitorTarget; check: CheckResultWithLocation }
  | { monitor: HeartbeatMonitor };

export interface IncidentUpdate {
  monitorId: string;
  /** A maintenance window covers the monitor at the time of the check run. */
  inMaintenance: boolean;
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

/** Reads kept until the next write, so page traffic between check runs reads no rows. */
type CachedReads = { view?: HubView; latency?: Map<string, LatencySample[]> };

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

function readHeartbeat(row: MonitorRow | undefined): HeartbeatState | null {
  return row?.heartbeat ? parseHeartbeatState(parseJson(row.heartbeat)) : null;
}

/**
 * The only owner of monitor state: incidents, latency samples and heartbeat
 * state. Check runs record into it and the status page reads from it.
 */
export class MonitorHub extends DurableObject<Env> {
  private readonly sql: Sql;
  private reads: CachedReads = {};

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = durableObjectSql(ctx.storage);
    migrate(this.sql);
    void ctx.blockConcurrencyWhile(() => importV1(this.sql, env.FLAREWATCH_STATE));
  }

  record(now: number, records: CheckRecord[]): IncidentUpdate[] {
    this.reads = {};
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
      const activeMaintenances = this.maintenances().filter((maintenance) =>
        isMaintenanceActive(maintenance, now * 1000),
      );

      for (const record of records) {
        const { monitor } = record;
        const row = rows.get(monitor.id);
        let result: CheckResult | undefined;

        if ('check' in record) {
          result = record.check.result;
          samples[monitor.id] = [result.latency ?? 0, record.check.location];
        } else {
          const stored = readHeartbeat(row);
          const evaluation = evaluateHeartbeat(
            record.monitor,
            parseHeartbeatSignal(stored ?? {}) ?? {},
            now,
          );
          result = evaluation.result;
          const heartbeat = JSON.stringify(
            withMisses(record.monitor, evaluation.heartbeat, stored?.misses, now),
          );
          if (heartbeat !== row?.heartbeat) this.writeHeartbeat(monitor.id, heartbeat);
        }

        if (!result) continue;
        if (!row?.started_at) {
          this.sql.exec(
            `INSERT INTO monitors (id, started_at) VALUES (?, ?)
             ON CONFLICT (id) DO UPDATE SET started_at = excluded.started_at`,
            monitor.id,
            now,
          );
        }
        updates.push({
          ...this.applyResult(monitor.id, result, open.get(monitor.id), now),
          inMaintenance: activeMaintenances.some((maintenance) =>
            coversMonitor(maintenance, monitor.id),
          ),
        });
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

  /** Records a job's ping. Its status changes at the next check run. */
  ping(monitor: HeartbeatMonitor, kind: PingKind, now: number, message?: string): void {
    this.reads = {};
    this.sql.transaction(() => {
      const [row] = this.sql.exec<MonitorRow>(
        'SELECT id, started_at, heartbeat FROM monitors WHERE id = ?',
        monitor.id,
      );
      const stored = readHeartbeat(row);
      const signal = applyPing(
        monitor,
        parseHeartbeatSignal(stored ?? {}) ?? {},
        kind,
        now,
        message,
      );
      const heartbeat: HeartbeatState = {
        ...signal,
        status: stored?.status ?? 'pending',
        ...(stored?.deadline !== undefined && { deadline: stored.deadline }),
        ...(stored?.misses && { misses: stored.misses }),
      };
      this.writeHeartbeat(monitor.id, JSON.stringify(heartbeat));
    });
  }

  private writeHeartbeat(monitorId: string, heartbeat: string): void {
    this.sql.exec(
      `INSERT INTO monitors (id, heartbeat) VALUES (?, ?)
       ON CONFLICT (id) DO UPDATE SET heartbeat = excluded.heartbeat`,
      monitorId,
      heartbeat,
    );
  }

  private applyResult(
    monitorId: string,
    result: CheckResult,
    open: { id: number; incident: Incident } | undefined,
    now: number,
  ): Omit<IncidentUpdate, 'inMaintenance'> {
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
        JSON.stringify(capSegments([...incident.start, now])),
        JSON.stringify(capSegments([...incident.error, result.error])),
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

  view(): HubView {
    this.reads.view ??= this.readView();
    return this.reads.view;
  }

  private readView(): HubView {
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
      const heartbeat = readHeartbeat(row);
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

    return {
      lastUpdate: meta ? Number(meta.value) : 0,
      monitors,
      maintenances: this.maintenances(),
    };
  }

  /** Oldest start first. */
  maintenances(): Maintenance[] {
    return parseMaintenances(
      this.sql
        .exec<{ data: string }>('SELECT data FROM maintenances')
        .map(({ data }) => parseJson(data)),
    ).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }

  putMaintenance(maintenance: Maintenance): void {
    this.reads = {};
    this.sql.exec(
      `INSERT INTO maintenances (id, data) VALUES (?, ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
      maintenance.id,
      JSON.stringify(maintenance),
    );
  }

  deleteMaintenance(id: string): boolean {
    this.reads = {};
    const [row] = this.sql.exec<{ id: string }>(
      'DELETE FROM maintenances WHERE id = ? RETURNING id',
      id,
    );
    return row !== undefined;
  }

  /** Oldest first. */
  latency(monitorId: string): LatencySample[] {
    this.reads.latency ??= this.readLatency();
    return this.reads.latency.get(monitorId) ?? [];
  }

  /** Every monitor's samples in one scan, so asking for each monitor costs no more rows. */
  private readLatency(): Map<string, LatencySample[]> {
    const samples = new Map<string, LatencySample[]>();
    for (const { at, id, ping, loc } of this.sql.exec<{
      at: number;
      id: string;
      ping: number | null;
      loc: string | null;
    }>(
      `SELECT s.at, j.key AS id, json_extract(j.value, '$[0]') AS ping, json_extract(j.value, '$[1]') AS loc
       FROM samples s, json_each(s.data) j ORDER BY s.at`,
    )) {
      if (typeof ping !== 'number' || typeof loc !== 'string') continue;
      const list = samples.get(id) ?? [];
      list.push({ ping, loc, time: at });
      samples.set(id, list);
    }
    return samples;
  }
}

const sampleSchema = z.record(z.string(), z.tuple([z.number(), z.string()]));

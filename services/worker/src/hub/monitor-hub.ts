import { DurableObject } from 'cloudflare:workers';
import * as z from 'zod/mini';
import {
  isMaintenanceActive,
  maintenanceExpiresAt,
  parseHeartbeatSignal,
  parseMaintenances,
  type Maintenance,
  parseHeartbeatState,
  type CheckResult,
  type CheckResultWithLocation,
  type HeartbeatMonitor,
  type HeartbeatState,
  type LatencySample,
  type MonitorTarget,
  type MonitorView,
  type HubView,
} from '@flarewatch/shared';
import type { Env } from '../env';
import { Alerts, type Alert, type AlertOutcome, type AlertPolicy } from './alerts';
import { applyPing, evaluateHeartbeat, withMisses, type PingKind } from './heartbeat';
import { Incidents, type IncidentUpdate } from './incidents';
import { migrate } from './schema';
import { durableObjectSql, parseJson, type Sql } from './sql';

/** How long History keeps closed incidents and ended maintenance windows. */
const HISTORY_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const LATENCY_RETENTION_SECONDS = 12 * 60 * 60;
const HOUR = 60 * 60;
const MAX_MAINTENANCES = 100;

/** A check monitor's result, or a heartbeat monitor, which the hub evaluates from its pings. */
export type CheckRecord =
  | { monitor: MonitorTarget; check: CheckResultWithLocation }
  | { monitor: HeartbeatMonitor };

type MonitorRow = { id: string; started_at: number | null; heartbeat: string | null };

/** One check run's samples: monitor id to [latency, location]. */
type Samples = Record<string, [number, string]>;

function readHeartbeat(row: MonitorRow | undefined): HeartbeatState | null {
  return row?.heartbeat ? parseHeartbeatState(parseJson(row.heartbeat)) : null;
}

/**
 * The only owner of monitor state: incidents, latency samples and heartbeat
 * state. Check runs record into it and the status page reads from it.
 */
export class MonitorHub extends DurableObject<Env> {
  private readonly sql: Sql;
  private readonly incidents: Incidents;
  private readonly alerts: Alerts;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = durableObjectSql(ctx.storage);
    migrate(this.sql);
    this.incidents = new Incidents(this.sql);
    this.alerts = new Alerts(this.sql);
  }

  /**
   * Stores one check run. With a policy (a webhook is configured) it also
   * decides the run's alerts; confirmAlerts records how each one's delivery went.
   */
  record(
    now: number,
    records: CheckRecord[],
    policy?: AlertPolicy,
  ): { updates: IncidentUpdate[]; alerts: Alert[] } {
    return this.sql.transaction(() => {
      const [last] = this.sql.exec<{ value: string; runs: number }>(
        "SELECT value, runs FROM meta WHERE key = 'last_update'",
      );
      // A run that outlasted a later one would put older results over newer ones.
      if (last && now < Number(last.value)) return { updates: [], alerts: [] };
      const run = (last?.runs ?? 0) + 1;
      const rows = new Map(
        this.sql
          .exec<MonitorRow>('SELECT id, started_at, heartbeat FROM monitors')
          .map((row) => [row.id, row]),
      );
      const open = this.incidents.open();
      const updates: IncidentUpdate[] = [];
      const samples: Samples = {};
      const maintenances = this.maintenances();
      const activeMaintenances = maintenances.filter((maintenance) =>
        isMaintenanceActive(maintenance, now * 1000),
      );

      for (const record of records) {
        const { monitor } = record;
        const row = rows.get(monitor.id);
        let result: CheckResult | undefined;

        if ('check' in record) {
          result = record.check.result;
          // A proxy names its own location; a long one would bloat the hour's row.
          samples[monitor.id] = [result.latency ?? 0, record.check.location.slice(0, 64)];
          // Left from when this id was a heartbeat monitor; the view would show the job's status.
          if (row?.heartbeat) {
            this.sql.exec('UPDATE monitors SET heartbeat = NULL WHERE id = ?', monitor.id);
          }
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
        updates.push(this.incidents.apply(monitor.id, result, open.get(monitor.id), now));
      }

      if (Object.keys(samples).length > 0) {
        const json = JSON.stringify(samples);
        this.sql.exec(
          `INSERT INTO latency (hour, data) VALUES (?, json_object(?, json(?)))
           ON CONFLICT (hour) DO UPDATE SET data = json_set(data, ?, json(?))`,
          Math.floor(now / HOUR),
          String(now),
          json,
          `$."${now}"`,
          json,
        );
      }
      this.sql.exec(
        'DELETE FROM latency WHERE hour < ?',
        Math.floor((now - LATENCY_RETENTION_SECONDS) / HOUR),
      );

      // A run lists every configured monitor. One that left the config ends its
      // outage now, and its row goes once retention below has removed its incidents.
      const configured = new Set(records.map(({ monitor }) => monitor.id));
      for (const [monitorId, incident] of open) {
        if (!configured.has(monitorId)) this.incidents.close(incident, now);
      }
      this.incidents.expire(now - HISTORY_RETENTION_SECONDS);
      for (const id of rows.keys()) {
        if (!configured.has(id) && !this.incidents.has(id)) {
          this.sql.exec('DELETE FROM monitors WHERE id = ?', id);
        }
      }
      for (const maintenance of maintenances) {
        const expiresAt = maintenanceExpiresAt(maintenance);
        if (expiresAt !== undefined && expiresAt < (now - HISTORY_RETENTION_SECONDS) * 1000) {
          this.sql.exec('DELETE FROM maintenances WHERE id = ?', maintenance.id);
        }
      }
      this.sql.exec(
        `INSERT INTO meta (key, value, runs) VALUES ('last_update', ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, runs = excluded.runs`,
        String(now),
        run,
      );
      const alerts = policy
        ? this.alerts.decide(
            {
              now,
              runNumber: run,
              monitors: records.map(({ monitor }) => monitor),
              updates,
              openBefore: open,
              openNow: this.incidents.open(),
              activeMaintenances,
            },
            policy,
          )
        : [];
      return { updates, alerts };
    });
  }

  /**
   * Records how each alert's delivery went. Returns the recovery alerts of
   * delivered outages that ended while they were being sent.
   */
  confirmAlerts(outcomes: AlertOutcome[]): Alert[] {
    return this.sql.transaction(() => this.alerts.record(outcomes));
  }

  /** Records a job's ping. Its status changes at the next check run. */
  ping(monitor: HeartbeatMonitor, kind: PingKind, now: number, message?: string): void {
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

  view(): HubView {
    const [meta] = this.sql.exec<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'last_update'",
    );
    const incidents = this.incidents.byMonitor();
    const [hour] = this.sql.exec<{ data: string }>(
      'SELECT data FROM latency ORDER BY hour DESC LIMIT 1',
    );
    const runs = parseHour(hour?.data ?? null);
    const latestAt = Math.max(...Object.keys(runs).map(Number));
    const latest = runs[latestAt] ?? {};

    const monitors: Record<string, MonitorView> = {};
    for (const row of this.sql.exec<MonitorRow>('SELECT id, started_at, heartbeat FROM monitors')) {
      const list = incidents.get(row.id) ?? [];
      const heartbeat = readHeartbeat(row);
      const sample = Object.prototype.hasOwnProperty.call(latest, row.id)
        ? latest[row.id]
        : undefined;
      const down = list[list.length - 1]?.end === undefined && list.length > 0;
      monitors[row.id] = {
        status: down ? 'down' : (heartbeat?.status ?? 'up'),
        incidents: list,
        ...(row.started_at !== null && { startedAt: row.started_at }),
        ...(sample && { latest: { ping: sample[0], loc: sample[1], time: latestAt } }),
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

  /** False, and nothing stored, when the id is new and the hub already holds MAX_MAINTENANCES. */
  putMaintenance(maintenance: Maintenance): boolean {
    const [existing] = this.sql.exec('SELECT 1 FROM maintenances WHERE id = ?', maintenance.id);
    if (!existing) {
      const [row] = this.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM maintenances');
      if ((row?.count ?? 0) >= MAX_MAINTENANCES) return false;
    }
    this.sql.exec(
      `INSERT INTO maintenances (id, data) VALUES (?, ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
      maintenance.id,
      JSON.stringify(maintenance),
    );
    return true;
  }

  deleteMaintenance(id: string): boolean {
    const [row] = this.sql.exec<{ id: string }>(
      'DELETE FROM maintenances WHERE id = ? RETURNING id',
      id,
    );
    return row !== undefined;
  }

  /** The last 12 hours before `now`, oldest first. */
  latency(monitorId: string, now: number): LatencySample[] {
    const cutoff = now - LATENCY_RETENTION_SECONDS;
    const samples: LatencySample[] = [];
    for (const { data } of this.sql.exec<{ data: string }>(
      'SELECT data FROM latency WHERE hour >= ?',
      Math.floor(cutoff / HOUR),
    )) {
      for (const [at, run] of Object.entries(parseHour(data))) {
        const sample = Object.prototype.hasOwnProperty.call(run, monitorId)
          ? run[monitorId]
          : undefined;
        const time = Number(at);
        if (sample && time >= cutoff) samples.push({ ping: sample[0], loc: sample[1], time });
      }
    }
    return samples.sort((a, b) => a.time - b.time);
  }
}

/** An hour's check runs: run time to that run's samples. */
const hourSchema = z.record(z.string(), z.record(z.string(), z.tuple([z.number(), z.string()])));

function parseHour(data: string | null): Record<string, Samples> {
  return hourSchema.safeParse(parseJson(data)).data ?? {};
}

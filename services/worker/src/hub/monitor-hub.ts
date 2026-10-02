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
  type LatencySample,
  type MonitorTarget,
  type MonitorView,
  type HubView,
  type Monitor,
} from '@flarewatch/shared';
import type { Env } from '../env';
import { applyPing, evaluateHeartbeat, withMisses, type PingKind } from './heartbeat';
import { Incidents, type IncidentUpdate, type OpenIncident } from './incidents';
import { migrate } from './schema';
import { durableObjectSql, parseJson, type Sql } from './sql';

/** How long History keeps closed incidents and ended maintenance windows. */
const HISTORY_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const LATENCY_RETENTION_SECONDS = 12 * 60 * 60;
const HOUR = 60 * 60;
/**
 * How long a run's claim on a down alert holds before another run may send it.
 * Longer than a cron run can last (15 minutes), so the run that made it is gone.
 */
const ALERT_CLAIM_SECONDS = 20 * 60;
/** Error-change alerts per incident, so a target whose error keeps changing cannot spam. */
const MAX_ERROR_ALERTS = 5;

/** A check monitor's result, or a heartbeat monitor, which the hub evaluates from its pings. */
export type CheckRecord =
  | { monitor: MonitorTarget; check: CheckResultWithLocation }
  | { monitor: HeartbeatMonitor };

/** The notification settings the hub decides alerts with. */
export interface AlertPolicy {
  gracePeriodSeconds: number;
  skipIds: string[];
  skipErrorChanges: boolean;
}

export interface Alert {
  monitorId: string;
  incident: number;
  kind: 'down' | 'error' | 'up';
  incidentStartTime: number;
  error: string;
  /** Down alerts only: names of the monitors behind this one that are down too. */
  alsoDown: string[];
  /** A recovery found only once its down alert was delivered: when it happened. */
  at?: number;
}

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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = durableObjectSql(ctx.storage);
    migrate(this.sql);
    this.incidents = new Incidents(this.sql);
  }

  /**
   * Stores one check run. With a policy (a webhook is configured) it also
   * decides the run's alerts; confirmAlerts records which down alerts arrived.
   */
  record(
    now: number,
    records: CheckRecord[],
    policy?: AlertPolicy,
  ): { updates: IncidentUpdate[]; alerts: Alert[] } {
    return this.sql.transaction(() => {
      const [last] = this.sql.exec<{ value: string }>(
        "SELECT value FROM meta WHERE key = 'last_update'",
      );
      // A run that outlasted a later one would put older results over newer ones.
      if (last && now < Number(last.value)) return { updates: [], alerts: [] };
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
      for (const { id, end } of maintenances) {
        if (end && new Date(end).getTime() < (now - HISTORY_RETENTION_SECONDS) * 1000) {
          this.sql.exec('DELETE FROM maintenances WHERE id = ?', id);
        }
      }
      this.sql.exec(
        `INSERT INTO meta (key, value) VALUES ('last_update', ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        String(now),
      );
      const alerts = policy
        ? this.decideAlerts(now, records, updates, open, activeMaintenances, policy)
        : [];
      return { updates, alerts };
    });
  }

  /**
   * Runs after every result is applied, so a monitor and the monitors it
   * depends on are judged on the same, finished run. A monitor is blocked
   * while anything it depends on, directly or through a chain, has an open
   * incident; a blocked monitor sends no new down or error alert.
   */
  private decideAlerts(
    now: number,
    records: CheckRecord[],
    updates: IncidentUpdate[],
    openBefore: Map<string, OpenIncident>,
    activeMaintenances: Maintenance[],
    policy: AlertPolicy,
  ): Alert[] {
    const monitors = records.map((record): Monitor => record.monitor);
    const openNow = this.incidents.open();
    const ancestors = dependencyClosure(monitors);
    const isDown = (id: string) => openNow.has(id);
    const blocked = (id: string) => [...(ancestors.get(id) ?? [])].some(isDown);
    const changes = new Map(updates.map((update) => [update.monitorId, update]));
    const alerts: Alert[] = [];

    for (const monitor of monitors) {
      if (policy.skipIds.includes(monitor.id)) continue;
      const change = changes.get(monitor.id);
      if (change?.changeType === 'up') {
        // Closes an alert that went out, whatever blocks or maintenance say now.
        const closed = openBefore.get(monitor.id);
        if (closed?.alert === 'sent') {
          // A held recovery ended when the monitor came back up, not now.
          const end = closed.upSince ?? undefined;
          alerts.push(recoveryAlert(monitor.id, closed.id, change.incidentStartTime, end));
        }
        continue;
      }

      const open = openNow.get(monitor.id);
      if (!open) continue;
      const start = open.incident.start[0] ?? now;
      const error = open.incident.error[open.incident.error.length - 1] ?? '';
      const quiet =
        blocked(monitor.id) ||
        activeMaintenances.some((maintenance) => coversMonitor(maintenance, monitor.id));

      // A claim older than any run means the run that made it died before reporting back.
      const due =
        open.alert === 'pending' ||
        (open.alert === 'sending' && now - (open.alertClaimedAt ?? 0) >= ALERT_CLAIM_SECONDS);
      if (due) {
        // A job's own graceSeconds already delays its down state.
        const grace = monitor.method === 'HEARTBEAT' ? 0 : policy.gracePeriodSeconds;
        // One run's wait lets a dependency that fails a run later cover this monitor.
        const held = (monitor.dependsOn?.length ?? 0) > 0 && change?.changeType === 'down';
        // A flapping monitor that is up again, waiting to close, is not down now.
        const recovering = open.upSince !== null;
        if (quiet || held || recovering || now - (open.reopenedAt ?? start) < grace) continue;
        this.incidents.claimAlert(open.id, now);
        alerts.push({
          monitorId: monitor.id,
          incident: open.id,
          kind: 'down',
          incidentStartTime: start,
          error,
          alsoDown: monitors
            .filter((other) => isDown(other.id) && ancestors.get(other.id)?.has(monitor.id))
            .map((other) => other.name),
        });
      } else if (
        open.alert === 'sent' &&
        change?.changeType === 'error' &&
        !quiet &&
        !policy.skipErrorChanges &&
        open.errorAlerts < MAX_ERROR_ALERTS
      ) {
        this.incidents.countErrorAlert(open.id);
        alerts.push({
          monitorId: monitor.id,
          incident: open.id,
          kind: 'error',
          incidentStartTime: start,
          error,
          alsoDown: [],
        });
      }
    }
    return alerts;
  }

  /**
   * Records which down alerts reached a webhook. Returns the recovery alerts of
   * delivered outages that ended while they were being sent.
   */
  confirmAlerts(outcomes: { incident: number; delivered: boolean }[]): Alert[] {
    return this.sql.transaction(() =>
      this.incidents
        .confirm(outcomes)
        .map(({ monitorId, id, start, end }) => recoveryAlert(monitorId, id, start, end)),
    );
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

  putMaintenance(maintenance: Maintenance): void {
    this.sql.exec(
      `INSERT INTO maintenances (id, data) VALUES (?, ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
      maintenance.id,
      JSON.stringify(maintenance),
    );
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

function recoveryAlert(monitorId: string, incident: number, start: number, at?: number): Alert {
  return {
    monitorId,
    incident,
    kind: 'up',
    incidentStartTime: start,
    error: '',
    alsoDown: [],
    ...(at !== undefined && { at }),
  };
}

/** Every monitor's dependencies, direct or through a chain. Config validation rules out loops. */
function dependencyClosure(monitors: Monitor[]): Map<string, Set<string>> {
  const byId = new Map(monitors.map((monitor) => [monitor.id, monitor]));
  const closure = new Map<string, Set<string>>();
  for (const monitor of monitors) {
    const found = new Set<string>();
    const pending = [...(monitor.dependsOn ?? [])];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (found.has(id) || id === monitor.id) continue;
      found.add(id);
      pending.push(...(byId.get(id)?.dependsOn ?? []));
    }
    closure.set(monitor.id, found);
  }
  return closure;
}

/** An hour's check runs: run time to that run's samples. */
const hourSchema = z.record(z.string(), z.record(z.string(), z.tuple([z.number(), z.string()])));

function parseHour(data: string | null): Record<string, Samples> {
  return hourSchema.safeParse(parseJson(data)).data ?? {};
}

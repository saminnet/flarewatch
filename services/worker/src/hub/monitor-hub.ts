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
  type Monitor,
} from '@flarewatch/shared';
import type { Env } from '../env';
import { applyPing, evaluateHeartbeat, withMisses, type PingKind } from './heartbeat';
import { capSegments } from './incident-segments';
import { migrate } from './schema';
import { durableObjectSql, type Sql } from './sql';

const INCIDENT_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const LATENCY_RETENTION_SECONDS = 12 * 60 * 60;
/** Failed deliveries of one down alert before the hub stops trying. */
export const MAX_ALERT_ATTEMPTS = 10;
/**
 * How long a run's claim on a down alert holds before another run may send it.
 * Longer than a cron run can last (15 minutes), so the run that made it is gone.
 */
const ALERT_CLAIM_SECONDS = 20 * 60;

/** A check monitor's result, or a heartbeat monitor, which the hub evaluates from its pings. */
export type CheckRecord =
  | { monitor: MonitorTarget; check: CheckResultWithLocation }
  | { monitor: HeartbeatMonitor };

export interface IncidentUpdate {
  monitorId: string;
  statusChanged: boolean;
  changeType: 'none' | 'up' | 'down' | 'error';
  isUp: boolean;
  incidentStartTime: number;
  error: string;
}

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
type IncidentRow = {
  id: number;
  monitor_id: string;
  starts: string;
  errors: string;
  end_at: number | null;
  alert: 'pending' | 'sending' | 'sent' | 'failed' | 'silent';
  alert_claimed_at: number | null;
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
            'SELECT id, monitor_id, starts, errors, end_at, alert FROM incidents WHERE end_at IS NULL',
          )
          .map((row) => [
            row.monitor_id,
            { id: row.id, incident: toIncident(row), alert: row.alert },
          ]),
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
        updates.push(this.applyResult(monitor.id, result, open.get(monitor.id), now));
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
    openBefore: Map<string, { id: number; alert: IncidentRow['alert'] }>,
    activeMaintenances: Maintenance[],
    policy: AlertPolicy,
  ): Alert[] {
    const monitors = records.map((record): Monitor => record.monitor);
    const openNow = new Map(
      this.sql
        .exec<IncidentRow>(
          `SELECT id, monitor_id, starts, errors, end_at, alert, alert_claimed_at
           FROM incidents WHERE end_at IS NULL`,
        )
        .map((row) => [row.monitor_id, row]),
    );
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
          alerts.push(recoveryAlert(monitor.id, closed.id, change.incidentStartTime));
        }
        continue;
      }

      const row = openNow.get(monitor.id);
      if (!row) continue;
      const incident = toIncident(row);
      const start = incident.start[0] ?? now;
      const error = incident.error[incident.error.length - 1] ?? '';
      const quiet =
        blocked(monitor.id) ||
        activeMaintenances.some((maintenance) => coversMonitor(maintenance, monitor.id));

      // A claim older than any run means the run that made it died before reporting back.
      const due =
        row.alert === 'pending' ||
        (row.alert === 'sending' && now - (row.alert_claimed_at ?? 0) >= ALERT_CLAIM_SECONDS);
      if (due) {
        // A job's own graceSeconds already delays its down state.
        const grace = monitor.method === 'HEARTBEAT' ? 0 : policy.gracePeriodSeconds;
        // One run's wait lets a dependency that fails a run later cover this monitor.
        const held = (monitor.dependsOn?.length ?? 0) > 0 && change?.changeType === 'down';
        if (quiet || held || now - start < grace) continue;
        // Claimed so an overlapping run skips it, until confirmAlerts hears how delivery went.
        this.sql.exec(
          "UPDATE incidents SET alert = 'sending', alert_claimed_at = ? WHERE id = ?",
          now,
          row.id,
        );
        alerts.push({
          monitorId: monitor.id,
          incident: row.id,
          kind: 'down',
          incidentStartTime: start,
          error,
          alsoDown: monitors
            .filter((other) => isDown(other.id) && ancestors.get(other.id)?.has(monitor.id))
            .map((other) => other.name),
        });
      } else if (
        row.alert === 'sent' &&
        change?.changeType === 'error' &&
        !quiet &&
        !policy.skipErrorChanges
      ) {
        alerts.push({
          monitorId: monitor.id,
          incident: row.id,
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
   * Records which down alerts reached a webhook. One that did not is due again
   * next run, until MAX_ALERT_ATTEMPTS failures. Returns the recovery alerts of
   * delivered outages that ended while they were being sent.
   */
  confirmAlerts(outcomes: { incident: number; delivered: boolean }[]): Alert[] {
    return this.sql.transaction(() => {
      const recoveries: Alert[] = [];
      for (const { incident, delivered } of outcomes) {
        if (!delivered) {
          this.sql.exec(
            `UPDATE incidents SET alert_attempts = alert_attempts + 1,
               alert = CASE WHEN alert_attempts + 1 >= ? THEN 'failed' ELSE 'pending' END
             WHERE id = ? AND alert = 'sending'`,
            MAX_ALERT_ATTEMPTS,
            incident,
          );
          continue;
        }
        const [ended] = this.sql.exec<IncidentRow>(
          `UPDATE incidents SET alert = 'sent' WHERE id = ? AND alert = 'sending'
           RETURNING id, monitor_id, starts, errors, end_at, alert, alert_claimed_at`,
          incident,
        );
        if (ended?.end_at != null) {
          const start = toIncident(ended).start[0] ?? ended.end_at;
          recoveries.push(recoveryAlert(ended.monitor_id, ended.id, start, ended.end_at));
        }
      }
      return recoveries;
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

const sampleSchema = z.record(z.string(), z.tuple([z.number(), z.string()]));

import { DurableObject } from 'cloudflare:workers';
import * as z from 'zod/mini';
import {
  isMaintenanceActive,
  coversMonitor,
  DEFAULT_SSL_EXPIRY_THRESHOLD_DAYS,
  maintenanceExpiresAt,
  parseAnnouncements,
  parseHeartbeatSignal,
  parseMaintenances,
  type Announcement,
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
import { migrate, parseHour, parseLatest } from './schema';
import { durableObjectSql, parseJson, type Sql } from './sql';

/** How long History keeps closed incidents and ended maintenance windows. */
const HISTORY_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const LATENCY_RETENTION_SECONDS = 12 * 60 * 60;
const HOUR = 60 * 60;
const MAX_MAINTENANCES = 100;
const MAX_ANNOUNCEMENTS = 50;
const MAX_EXPIRY_CLAIMS = 32;

/** A check monitor's result, or a heartbeat monitor, which the hub evaluates from its pings. */
export type CheckRecord =
  | { monitor: MonitorTarget; check?: CheckResultWithLocation }
  | { monitor: HeartbeatMonitor };

type MonitorRow = {
  id: string;
  started_at: number | null;
  heartbeat: string | null;
  failure_count: number;
  first_failure_at: number | null;
  warning: string | null;
};

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

  claimInitialCheck(nowMs: number): boolean {
    return this.sql.transaction(() => {
      const rows = this.sql.exec<{ key: string; value: string }>(
        "SELECT key, value FROM meta WHERE key IN ('last_update', 'initial_trigger')",
      );
      if (
        rows.some(({ key, value }) =>
          key === 'last_update' ? Number(value) > 0 : nowMs - Number(value) < 60_000,
        )
      )
        return false;
      this.sql.exec(
        `INSERT INTO meta (key, value) VALUES ('initial_trigger', ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        String(nowMs),
      );
      return true;
    });
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
      const [last] = this.sql.exec<{ value: string; runs: number; latest: string }>(
        "SELECT value, runs, latest FROM meta WHERE key = 'last_update'",
      );
      // A run that outlasted a later one would put older results over newer ones.
      if (last && now < Number(last.value)) return { updates: [], alerts: [] };
      const run = (last?.runs ?? 0) + 1;
      const rows = new Map(
        this.sql
          .exec<MonitorRow>(
            'SELECT id, started_at, heartbeat, failure_count, first_failure_at, warning FROM monitors',
          )
          .map((row) => [row.id, row]),
      );
      const open = this.incidents.open();
      const updates: IncidentUpdate[] = [];
      const samples: Samples = {};
      const latest = new Map(Object.entries(parseLatest(last?.latest ?? null)));
      const warningAlerts: Alert[] = [];
      const warnings = new Map([...rows].map(([id, row]) => [id, parseWarning(row.warning)]));
      const maintenances = this.maintenances();
      const activeMaintenances = maintenances.filter((maintenance) =>
        isMaintenanceActive(maintenance, now * 1000),
      );

      for (const record of records) {
        const { monitor } = record;
        const row = rows.get(monitor.id);
        let result: CheckResult | undefined;

        if (record.monitor.method !== 'HEARTBEAT') {
          const check = 'check' in record ? record.check : undefined;
          if (!check) continue;
          result = check.result;
          // A proxy names its own location; a long one would bloat the hour's row.
          samples[monitor.id] = [result.latency ?? 0, check.location.slice(0, 64)];
          latest.set(monitor.id, {
            ping: result.latency ?? 0,
            loc: check.location.slice(0, 64),
            time: now,
          });
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
        let warning = result.ok ? result.warning : undefined;
        if (result.ok && monitor.method !== 'HEARTBEAT' && monitor.sslCheckEnabled && result.ssl) {
          const ssl = result.ssl;
          if (ssl.expiryDate <= now)
            result = { ok: false, error: 'Certificate has expired', latency: result.latency };
          else if (
            ssl.daysUntilExpiry <=
            (monitor.sslCheckDaysBeforeExpiry ?? DEFAULT_SSL_EXPIRY_THRESHOLD_DAYS)
          ) {
            warning = {
              text: `Certificate expires on ${new Date(ssl.expiryDate * 1000).toISOString().slice(0, 10)} (${ssl.daysUntilExpiry} days remaining)`,
              expiryDate: ssl.expiryDate,
            };
          }
        }
        const warningJson = warning ? JSON.stringify(warning) : null;
        if (warningJson !== (row?.warning ?? null))
          this.sql.exec('UPDATE monitors SET warning = ? WHERE id = ?', warningJson, monitor.id);
        warnings.set(monitor.id, warning);
        let firstFailure = now;
        if (monitor.method !== 'HEARTBEAT') {
          const count = row?.failure_count ?? 0;
          if (result.ok && count > 0) {
            this.sql.exec(
              'UPDATE monitors SET failure_count = 0, first_failure_at = NULL WHERE id = ?',
              monitor.id,
            );
          } else if (!result.ok && !open.has(monitor.id) && (monitor.downAfterChecks ?? 1) > 1) {
            firstFailure = row?.first_failure_at ?? now;
            this.sql.exec(
              'UPDATE monitors SET failure_count = ?, first_failure_at = ? WHERE id = ?',
              count + 1,
              firstFailure,
              monitor.id,
            );
            if (count + 1 < monitor.downAfterChecks!) continue;
          }
        }
        updates.push(
          this.incidents.apply(monitor.id, result, open.get(monitor.id), now, firstFailure),
        );
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
      if (policy) {
        for (const { monitor } of records) {
          const warning = warnings.get(monitor.id);
          if (
            !warning ||
            policy.skipIds.includes(monitor.id) ||
            activeMaintenances.some((maintenance) => coversMonitor(maintenance, monitor.id))
          )
            continue;
          this.sql.exec(
            'DELETE FROM expiry_alerts WHERE monitor_id = ? AND expiry_date < ?',
            monitor.id,
            now - HISTORY_RETENTION_SECONDS,
          );
          const claimed = this.sql.exec(
            `INSERT INTO expiry_alerts (monitor_id, expiry_date, run) VALUES (?, ?, ?)
               ON CONFLICT DO NOTHING RETURNING monitor_id`,
            monitor.id,
            warning.expiryDate,
            run,
          );
          if (claimed.length > 0) {
            this.sql.exec(
              `DELETE FROM expiry_alerts WHERE monitor_id = ? AND expiry_date IN (
                 SELECT expiry_date FROM expiry_alerts WHERE monitor_id = ?
                 ORDER BY run DESC, expiry_date DESC LIMIT -1 OFFSET ?
               )`,
              monitor.id,
              monitor.id,
              MAX_EXPIRY_CLAIMS,
            );
            warningAlerts.push({
              monitorId: monitor.id,
              incident: 0,
              kind: 'expiry',
              incidentStartTime: now,
              error: warning.text,
              alsoDown: [],
              reopenedAt: null,
              run,
              expiryDate: warning.expiryDate,
            });
          }
        }
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
        `INSERT INTO meta (key, value, runs, latest) VALUES ('last_update', ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, runs = excluded.runs, latest = excluded.latest`,
        String(now),
        run,
        JSON.stringify(
          Object.fromEntries(
            records.flatMap(({ monitor }) => {
              const sample = latest.get(monitor.id);
              return monitor.method !== 'HEARTBEAT' && sample ? [[monitor.id, sample]] : [];
            }),
          ),
        ),
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
      if (!policy) this.sql.exec('DELETE FROM pending_recoveries');
      return { updates, alerts: [...alerts, ...warningAlerts] };
    });
  }

  confirmAlerts(outcomes: AlertOutcome[]): void {
    this.sql.transaction(() => this.alerts.record(outcomes));
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
    const [meta] = this.sql.exec<{ value: string; latest: string }>(
      "SELECT value, latest FROM meta WHERE key = 'last_update'",
    );
    const incidents = this.incidents.byMonitor();
    const latest = parseLatest(meta?.latest ?? null);

    const monitors: Record<string, MonitorView> = {};
    for (const row of this.sql.exec<MonitorRow>(
      'SELECT id, started_at, heartbeat, warning FROM monitors',
    )) {
      const list = incidents.get(row.id) ?? [];
      const heartbeat = readHeartbeat(row);
      const sample = Object.prototype.hasOwnProperty.call(latest, row.id)
        ? latest[row.id]
        : undefined;
      const down = list[list.length - 1]?.end === undefined && list.length > 0;
      const warning = parseWarning(row.warning);
      monitors[row.id] = {
        status: down ? 'down' : (heartbeat?.status ?? (warning ? 'degraded' : 'up')),
        ...(warning && { warning: warning.text }),
        incidents: list,
        ...(row.started_at !== null && { startedAt: row.started_at }),
        ...(sample && { latest: sample }),
        ...(heartbeat && { heartbeat }),
      };
    }

    return {
      lastUpdate: meta ? Number(meta.value) : 0,
      monitors,
      maintenances: this.maintenances(),
      announcements: this.announcements(),
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

  announcements(): Announcement[] {
    return parseAnnouncements(
      this.sql
        .exec<{ data: string }>('SELECT data FROM announcements')
        .map(({ data }) => parseJson(data)),
    ).sort((a, b) => b.createdAt - a.createdAt);
  }

  putAnnouncement(announcement: Announcement): boolean {
    const [existing] = this.sql.exec('SELECT 1 FROM announcements WHERE id = ?', announcement.id);
    if (!existing) {
      const [row] = this.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM announcements');
      if ((row?.count ?? 0) >= MAX_ANNOUNCEMENTS) return false;
    }
    this.sql.exec(
      `INSERT INTO announcements (id, data) VALUES (?, ?)
       ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
      announcement.id,
      JSON.stringify(announcement),
    );
    return true;
  }

  deleteAnnouncement(id: string): boolean {
    const [row] = this.sql.exec<{ id: string }>(
      'DELETE FROM announcements WHERE id = ? RETURNING id',
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

const warningSchema = z.object({ text: z.string(), expiryDate: z.number() });

function parseWarning(data: string | null) {
  return warningSchema.safeParse(parseJson(data)).data;
}

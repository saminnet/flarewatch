import { coversMonitor, type Maintenance, type Monitor } from '@flarewatch/shared';
import type { IncidentUpdate, OpenIncident } from './incidents';
import type { Sql } from './sql';

/** Failed deliveries of one down alert before the hub stops trying. */
const MAX_ALERT_ATTEMPTS = 10;
/**
 * How long a run's claim on a down alert holds before another run may send it.
 * Longer than a cron run can last (15 minutes), so the run that made it is gone.
 */
const ALERT_CLAIM_SECONDS = 20 * 60;
/** Error-change alerts per incident, so a target whose error keeps changing cannot spam. */
const MAX_ERROR_ALERTS = 5;

/** What an alert says: the outage began, its error changed, it goes on, or it ended. */
export type AlertKind = 'down' | 'error' | 'reminder' | 'recovered';

/**
 * Whether the incident's down alert reached a webhook: 'pending', 'sending'
 * (claimed by a run), 'sent', 'failed' (gave up) or 'silent' (never alert).
 */
type AlertState = 'pending' | 'sending' | 'sent' | 'failed' | 'silent';

/** An incident's alert columns. */
export interface IncidentAlert {
  state: AlertState;
  claimedAt: number | null;
  /** Error-change alerts claimed and not refused since the incident last opened. */
  errorAlerts: number;
  /** The check run that claimed the last down alert or reminder; null before reminders existed. */
  run: number | null;
  /** Reminders a webhook accepted since the incident last opened. */
  reminders: number;
}

/** The alert columns, for the query that loads the open incidents. */
export const ALERT_COLUMNS = 'alert, alert_claimed_at, error_alerts, alert_run, reminders';

export type AlertRow = {
  alert: AlertState;
  alert_claimed_at: number | null;
  error_alerts: number;
  alert_run: number | null;
  reminders: number;
};

export function readAlert(row: AlertRow): IncidentAlert {
  return {
    state: row.alert,
    claimedAt: row.alert_claimed_at,
    errorAlerts: row.error_alerts,
    run: row.alert_run,
    reminders: row.reminders,
  };
}

/**
 * The alert columns a reopen sets, in the reopen's own UPDATE. The down alert
 * is due again unless it is still waiting to go out: the outage it covered ended.
 */
export const REOPEN_ALERT_RESET = `error_alerts = 0, reminders = 0,
  alert_attempts = CASE WHEN alert IN ('pending', 'sending') THEN alert_attempts ELSE 0 END,
  alert = CASE WHEN alert IN ('pending', 'sending') THEN alert ELSE 'pending' END`;

/** The notification settings the hub decides alerts with. */
export interface AlertPolicy {
  gracePeriodSeconds: number;
  /** Monitors that never alert: skipNotificationIds, and monitors no webhook routes. */
  skipIds: string[];
  skipErrorChanges: boolean;
}

export interface Alert {
  monitorId: string;
  incident: number;
  kind: AlertKind;
  incidentStartTime: number;
  error: string;
  /** Down alerts only: names of the monitors behind this one that are down too. */
  alsoDown: string[];
  /** A recovery found only once its down alert was delivered: when it happened. */
  at?: number;
  /** Reminders only: this one's number, counted from 1. */
  reminder?: number;
  /**
   * The incident's reopened_at when the alert was decided. A reopen resets the
   * counters an outcome updates, so an outcome from before it is dropped.
   */
  reopenedAt: number | null;
  /**
   * The check run that decided the alert. A later run can take over a stale
   * claim, so a down alert's outcome counts only while its run holds the claim.
   */
  run: number;
}

/** Whether any webhook accepted an alert. */
export interface AlertOutcome {
  incident: number;
  kind: AlertKind;
  /** The alert's reopenedAt, handed back unchanged. */
  reopenedAt: number | null;
  /** The alert's run, handed back unchanged. */
  run: number;
  delivered: boolean;
  /** Not tried: the run had no requests left for it. */
  deferred?: boolean;
}

/** One check run's view of what changed, for the alert rules. */
export interface AlertRun {
  now: number;
  /** The check run's number, counted in meta. */
  runNumber: number;
  monitors: Monitor[];
  updates: IncidentUpdate[];
  /** Open incidents before the run's results were applied. */
  openBefore: Map<string, OpenIncident>;
  /** Open incidents after. */
  openNow: Map<string, OpenIncident>;
  activeMaintenances: Maintenance[];
}

/** Decides each kind of alert, claims it, and records how its delivery went. */
export class Alerts {
  constructor(private readonly sql: Sql) {}

  /**
   * Runs after every result is applied, so a monitor and the monitors it
   * depends on are judged on the same, finished run. A monitor is blocked
   * while anything it depends on, directly or through a chain, has an open
   * incident; a blocked monitor sends no new down or error alert.
   */
  decide(run: AlertRun, policy: AlertPolicy): Alert[] {
    const { now, runNumber, monitors, openBefore, openNow, activeMaintenances } = run;
    const ancestors = dependencyClosure(monitors);
    const isDown = (id: string) => openNow.has(id);
    const blocked = (id: string) => [...(ancestors.get(id) ?? [])].some(isDown);
    const changes = new Map(run.updates.map((update) => [update.monitorId, update]));
    const alerts: Alert[] = [];

    for (const monitor of monitors) {
      if (policy.skipIds.includes(monitor.id)) continue;
      const change = changes.get(monitor.id);
      if (change?.changeType === 'up') {
        // Closes an alert that went out, whatever blocks or maintenance say now.
        const closed = openBefore.get(monitor.id);
        if (closed?.alert.state === 'sent') {
          // A held recovery ended when the monitor came back up, not now.
          const end = closed.upSince ?? undefined;
          alerts.push(
            recoveryAlert(
              monitor.id,
              closed.id,
              closed.reopenedAt,
              runNumber,
              change.incidentStartTime,
              end,
            ),
          );
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
      const { state, claimedAt, errorAlerts, reminders } = open.alert;
      // A flapping monitor that is up again, waiting to close, is not down now.
      const recovering = open.upSince !== null;

      // A claim older than any run means the run that made it died before reporting back.
      const due =
        state === 'pending' ||
        (state === 'sending' && now - (claimedAt ?? 0) >= ALERT_CLAIM_SECONDS);
      if (due) {
        // A job's own graceSeconds already delays its down state.
        const grace = monitor.method === 'HEARTBEAT' ? 0 : policy.gracePeriodSeconds;
        // One run's wait lets a dependency that fails a run later cover this monitor.
        const held = (monitor.dependsOn?.length ?? 0) > 0 && change?.changeType === 'down';
        if (quiet || held || recovering || now - (open.reopenedAt ?? start) < grace) continue;
        // Claimed so an overlapping run skips it, until record hears how delivery went.
        this.sql.exec(
          "UPDATE incidents SET alert = 'sending', alert_claimed_at = ?, alert_run = ? WHERE id = ?",
          now,
          runNumber,
          open.id,
        );
        alerts.push({
          monitorId: monitor.id,
          incident: open.id,
          reopenedAt: open.reopenedAt,
          run: runNumber,
          kind: 'down',
          incidentStartTime: start,
          error,
          alsoDown: monitors
            .filter((other) => isDown(other.id) && ancestors.get(other.id)?.has(monitor.id))
            .map((other) => other.name),
        });
      } else if (
        state === 'sent' &&
        change?.changeType === 'error' &&
        !quiet &&
        !policy.skipErrorChanges &&
        errorAlerts < MAX_ERROR_ALERTS
      ) {
        // Counted now, so an overlapping run cannot pass the cap; a refused one is given back.
        this.sql.exec('UPDATE incidents SET error_alerts = error_alerts + 1 WHERE id = ?', open.id);
        alerts.push({
          monitorId: monitor.id,
          incident: open.id,
          reopenedAt: open.reopenedAt,
          run: runNumber,
          kind: 'error',
          incidentStartTime: start,
          error,
          alsoDown: [],
        });
      } else if (
        state === 'sent' &&
        monitor.reminderEveryChecks !== undefined &&
        runNumber - (open.alert.run ?? 0) >= monitor.reminderEveryChecks &&
        !quiet &&
        !recovering
      ) {
        // Moving the count on is the claim: an overlapping run finds the next reminder not due.
        this.sql.exec('UPDATE incidents SET alert_run = ? WHERE id = ?', runNumber, open.id);
        alerts.push({
          monitorId: monitor.id,
          incident: open.id,
          reopenedAt: open.reopenedAt,
          run: runNumber,
          kind: 'reminder',
          incidentStartTime: start,
          error,
          alsoDown: [],
          reminder: reminders + 1,
        });
      }
    }
    return alerts;
  }

  /**
   * Records how each alert's delivery went. A down alert no webhook accepted is
   * due again next run, until MAX_ALERT_ATTEMPTS failures; a deferred one is due
   * again with no failure counted. Returns the recovery
   * alerts of delivered outages that ended while they were being sent.
   */
  record(outcomes: AlertOutcome[]): Alert[] {
    const recoveries: Alert[] = [];
    for (const { incident, kind, reopenedAt, run, delivered, deferred } of outcomes) {
      if (kind === 'error' && !delivered) {
        this.sql.exec(
          `UPDATE incidents SET error_alerts = error_alerts - 1
           WHERE id = ? AND error_alerts > 0 AND reopened_at IS ?`,
          incident,
          reopenedAt,
        );
      }
      // A refused reminder keeps its number for the next one.
      if (kind === 'reminder' && delivered) {
        this.sql.exec(
          'UPDATE incidents SET reminders = reminders + 1 WHERE id = ? AND reopened_at IS ?',
          incident,
          reopenedAt,
        );
      }
      if (kind !== 'down') continue;
      if (deferred) {
        this.sql.exec(
          "UPDATE incidents SET alert = 'pending' WHERE id = ? AND alert = 'sending' AND alert_run = ?",
          incident,
          run,
        );
        continue;
      }
      if (!delivered) {
        this.sql.exec(
          `UPDATE incidents SET alert_attempts = alert_attempts + 1,
             alert = CASE WHEN alert_attempts + 1 >= ? THEN 'failed' ELSE 'pending' END
           WHERE id = ? AND alert = 'sending' AND alert_run = ?`,
          MAX_ALERT_ATTEMPTS,
          incident,
          run,
        );
        continue;
      }
      const [row] = this.sql.exec<{
        monitor_id: string;
        start: number | null;
        end_at: number | null;
        reopened_at: number | null;
      }>(
        `UPDATE incidents SET alert = 'sent' WHERE id = ? AND alert = 'sending' AND alert_run = ?
         RETURNING monitor_id, end_at, reopened_at,
           CASE WHEN json_valid(starts) THEN json_extract(starts, '$[0]') END AS start`,
        incident,
        run,
      );
      if (row?.end_at != null) {
        recoveries.push(
          recoveryAlert(
            row.monitor_id,
            incident,
            row.reopened_at,
            run,
            row.start ?? row.end_at,
            row.end_at,
          ),
        );
      }
    }
    return recoveries;
  }
}

function recoveryAlert(
  monitorId: string,
  incident: number,
  reopenedAt: number | null,
  run: number,
  start: number,
  at?: number,
): Alert {
  return {
    monitorId,
    incident,
    reopenedAt,
    run,
    kind: 'recovered',
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

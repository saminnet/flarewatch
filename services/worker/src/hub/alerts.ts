import { ExpiryReceiptState, stepExpiryReceipt } from './expiry-lifecycle';
import { RecoveryState, stepRecovery, type Recovery } from './recovery-lifecycle';
import { ErrorFollowUpState, stepErrorFollowUp, stepReminder } from './follow-up-lifecycle';
import { DownAlertState, stepDownAlert } from './down-alert-lifecycle';
import { coversMonitor, type Maintenance, type Monitor } from '@flarewatch/shared';
import type { IncidentUpdate, OpenIncident } from './incidents';
import type { Sql } from './sql';

export type AlertKind = 'down' | 'error' | 'reminder' | 'recovered' | 'expiry';

/** An incident's alert columns. */
export interface IncidentAlert {
  state: DownAlertState;
  attempts: number;
  claimedAt: number | null;
  /** Error-change alerts claimed and not refused since the incident last opened. */
  errorAlerts: number;
  /** An error change a run deferred, owed to the next run that can send it. */
  errorDue: boolean;
  errorRun: number | null;
  /** The check run that claimed the last down alert or reminder; null before reminders existed. */
  run: number | null;
  /** Reminders a webhook accepted since the incident last opened. */
  reminders: number;
  subscriberNotified: boolean;
}

/** The alert columns, for the query that loads the open incidents. */
export const ALERT_COLUMNS =
  'alert, alert_attempts, alert_claimed_at, error_alerts, error_due, error_run, alert_run, reminders, subscriber_notified';

export type AlertRow = {
  alert: DownAlertState;
  alert_attempts: number;
  alert_claimed_at: number | null;
  error_alerts: number;
  error_due: number;
  error_run: number | null;
  alert_run: number | null;
  reminders: number;
  subscriber_notified: number;
};

export function readAlert(row: AlertRow): IncidentAlert {
  return {
    state: row.alert,
    attempts: row.alert_attempts,
    claimedAt: row.alert_claimed_at,
    errorAlerts: row.error_alerts,
    errorDue: row.error_due === 1,
    errorRun: row.error_run,
    run: row.alert_run,
    reminders: row.reminders,
    subscriberNotified: row.subscriber_notified === 1,
  };
}

/** The notification settings the hub decides alerts with. */
export interface AlertPolicy {
  gracePeriodSeconds: number;
  webhookIds?: string[];
  /** Monitors excluded from every alert channel. */
  skipIds: string[];
  skipErrorChanges: boolean;
}

export function routesToWebhook(policy: AlertPolicy, id: string): boolean {
  return !policy.webhookIds || policy.webhookIds.includes(id);
}

export interface Alert {
  ackedBy?: string;
  expiryDate?: number;
  monitorId: string;
  incident: number;
  kind: AlertKind;
  incidentStartTime: number;
  error: string;
  /** Down alerts only: names of the monitors behind this one that are down too. */
  alsoDown: string[];
  /** Recoveries only: when the outage ended. */
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

/** Whether a delivery channel accepted an alert. */
export interface AlertOutcome {
  monitorId: string;
  expiryDate?: number;
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
          this.queueRecovery(
            monitor.id,
            closed.id,
            closed.reopenedAt,
            change.incidentStartTime,
            closed.upSince ?? now,
            closed.incident.acked_by ?? null,
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
      const { state, reminders } = open.alert;
      const webhook = routesToWebhook(policy, monitor.id);
      // A flapping monitor that is up again, waiting to close, is not down now.
      const recovering = open.upSince !== null;

      // A claim older than any run means the run that made it died before reporting back.
      const due = stepDownAlert(open.alert, {
        type: 'eligible',
        now,
        run: runNumber,
      }).claim;
      if (due) {
        // A job's own graceSeconds already delays its down state.
        const grace = monitor.method === 'HEARTBEAT' ? 0 : policy.gracePeriodSeconds;
        // One run's wait lets a dependency that fails a run later cover this monitor.
        const held = (monitor.dependsOn?.length ?? 0) > 0 && change?.changeType === 'down';
        if (
          quiet ||
          held ||
          recovering ||
          now - (open.relapsedAt ?? open.reopenedAt ?? start) < grace
        )
          continue;
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
        stepErrorFollowUp(errorFollowUpLifecycle(open.alert, open.reopenedAt), {
          type: 'eligible',
          run: runNumber,
          changed: change?.changeType === 'error',
          eligible:
            webhook && state === 'sent' && !quiet && !recovering && !policy.skipErrorChanges,
        }).claim
      ) {
        // Counted now, so an overlapping run cannot pass the cap; a refused one is given back.
        this.sql.exec(
          'UPDATE incidents SET error_alerts = error_alerts + 1, error_due = 0, error_run = ? WHERE id = ?',
          runNumber,
          open.id,
        );
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
        stepReminder(reminderLifecycle(open.alert, open.reopenedAt), {
          type: 'eligible',
          run: runNumber,
          interval: monitor.reminderEveryChecks,
          eligible:
            webhook &&
            state === 'sent' &&
            open.incident.acked_at === undefined &&
            !quiet &&
            !recovering,
        }).claim
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
    const order = new Map(monitors.map(({ id }, index) => [id, index]));
    return [...alerts, ...this.claimRecoveries(run, policy)].sort(
      (a, b) => order.get(a.monitorId)! - order.get(b.monitorId)!,
    );
  }

  /** One per monitor: a newer recovery replaces an older one that never went out. */
  private queueRecovery(
    monitorId: string,
    incident: number,
    reopenedAt: number | null,
    start: number,
    at: number,
    ackedBy: string | null,
  ): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO pending_recoveries (monitor_id, incident, reopened_at, start, at, acked_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      monitorId,
      incident,
      reopenedAt,
      start,
      at,
      ackedBy,
    );
  }

  /**
   * Claims the queued recoveries no live run holds. A recovery is dropped once
   * its monitor is down again, leaves the config or stops alerting.
   */
  private claimRecoveries({ now, runNumber, monitors, openNow }: AlertRun, policy: AlertPolicy) {
    const alerting = new Set(
      monitors.filter(({ id }) => !policy.skipIds.includes(id)).map(({ id }) => id),
    );
    const claimed: Alert[] = [];
    for (const row of this.sql.exec<PendingRecoveryRow>(
      'SELECT * FROM pending_recoveries ORDER BY at',
    )) {
      const transition = stepRecovery(
        readRecovery(row),
        !alerting.has(row.monitor_id) || openNow.has(row.monitor_id)
          ? { type: 'cancelled' }
          : {
              type: 'eligible',
              now,
              run: runNumber,
            },
      );
      if (transition.effect === 'delete') {
        this.sql.exec('DELETE FROM pending_recoveries WHERE monitor_id = ?', row.monitor_id);
        continue;
      }
      if (transition.effect !== 'claim') continue;
      this.sql.exec(
        'UPDATE pending_recoveries SET claimed_run = ?, claimed_at = ? WHERE monitor_id = ?',
        runNumber,
        now,
        row.monitor_id,
      );
      claimed.push(
        recoveryAlert(
          row.monitor_id,
          row.incident,
          row.reopened_at,
          runNumber,
          row.start,
          row.at,
          row.acked_by ?? undefined,
        ),
      );
    }
    return claimed;
  }

  /**
   * Records how each alert's delivery went. A down alert no delivery channel accepted is
   * due again next run, until MAX_ALERT_ATTEMPTS failures; a deferred one is due
   * again with no failure counted. A recovery goes once tried and waits for a
   * later run when deferred. A delivered outage that ended while its alert was
   * being sent queues its recovery for the next run.
   */
  record(outcomes: AlertOutcome[]): void {
    for (const {
      incident,
      kind,
      reopenedAt,
      run,
      delivered,
      deferred,
      monitorId,
      expiryDate,
    } of outcomes) {
      const type = delivered ? 'delivered' : deferred ? 'deferred' : 'refused';
      if (kind === 'expiry' && expiryDate !== undefined) {
        const [row] = this.sql.exec<{ run: number; retry_run: number | null }>(
          'SELECT run, retry_run FROM expiry_alerts WHERE monitor_id = ? AND expiry_date = ?',
          monitorId,
          expiryDate,
        );
        const current = !row
          ? ({ state: ExpiryReceiptState.Absent } as const)
          : row.retry_run === null
            ? ({ state: ExpiryReceiptState.Recorded, run: row.run } as const)
            : ({
                state: ExpiryReceiptState.RetryWaiting,
                run: row.run,
                retryRun: row.retry_run,
              } as const);
        const transition = stepExpiryReceipt(current, { type, run });
        if (transition.effect === 'delete') {
          this.sql.exec(
            'DELETE FROM expiry_alerts WHERE monitor_id = ? AND expiry_date = ? AND run = ?',
            monitorId,
            expiryDate,
            run,
          );
        } else if (transition.effect === 'wait') {
          this.sql.exec(
            'UPDATE expiry_alerts SET retry_run = ? WHERE monitor_id = ? AND expiry_date = ? AND run = ?',
            transition.next.retryRun,
            monitorId,
            expiryDate,
            run,
          );
        }
        continue;
      }
      if (kind === 'recovered') {
        const [row] = this.sql.exec<PendingRecoveryRow>(
          'SELECT * FROM pending_recoveries WHERE monitor_id = ?',
          monitorId,
        );
        const transition = stepRecovery(row ? readRecovery(row) : { state: RecoveryState.Absent }, {
          type: deferred ? 'deferred' : 'attempted',
          incident,
          run,
        });
        if (transition.effect === 'release') {
          this.sql.exec(
            'UPDATE pending_recoveries SET claimed_run = NULL, claimed_at = NULL WHERE monitor_id = ? AND incident = ? AND claimed_run = ?',
            monitorId,
            incident,
            run,
          );
        } else if (transition.effect === 'delete') {
          this.sql.exec(
            'DELETE FROM pending_recoveries WHERE monitor_id = ? AND incident = ? AND claimed_run = ?',
            monitorId,
            incident,
            run,
          );
        }
        continue;
      }
      if (kind === 'expiry') continue;
      const [row] = this.sql.exec<
        AlertRow & {
          monitor_id: string;
          start: number | null;
          acked_by: string | null;
          end_at: number | null;
          reopened_at: number | null;
        }
      >(
        `SELECT ${ALERT_COLUMNS}, monitor_id, end_at, reopened_at, acked_by,
          CASE WHEN json_valid(starts) THEN json_extract(starts, '$[0]') END AS start
         FROM incidents WHERE id = ?`,
        incident,
      );
      if (!row) continue;
      const alert = readAlert(row);
      if (kind === 'error') {
        const current = errorFollowUpLifecycle(alert, row.reopened_at);
        const { next } = stepErrorFollowUp(current, {
          type,
          run,
          generation: reopenedAt,
        });
        if (next === current) continue;
        this.sql.exec(
          'UPDATE incidents SET error_alerts = ?, error_due = ? WHERE id = ? AND error_alerts > 0 AND reopened_at IS ?',
          next.count,
          Number(next.state === ErrorFollowUpState.Owed),
          incident,
          reopenedAt,
        );
        continue;
      }
      if (kind === 'reminder') {
        const current = reminderLifecycle(alert, row.reopened_at);
        const { next } = stepReminder(current, {
          type,
          generation: reopenedAt,
        });
        if (next === current) continue;
        this.sql.exec(
          'UPDATE incidents SET reminders = ? WHERE id = ? AND reopened_at IS ?',
          next.count,
          incident,
          reopenedAt,
        );
        continue;
      }
      const { next } = stepDownAlert(alert, { type, run });
      if (next === alert) continue;
      this.sql.exec(
        `UPDATE incidents SET alert = ?, alert_attempts = ?
         WHERE id = ? AND alert = 'sending' AND alert_run = ?`,
        next.state,
        next.attempts,
        incident,
        run,
      );
      if (next.state === DownAlertState.Sent && row.end_at !== null) {
        this.queueRecovery(
          row.monitor_id,
          incident,
          row.reopened_at,
          row.start ?? row.end_at,
          row.end_at,
          row.acked_by,
        );
      }
    }
  }
}

type PendingRecoveryRow = {
  acked_by: string | null;
  monitor_id: string;
  incident: number;
  reopened_at: number | null;
  start: number;
  at: number;
  claimed_at: number | null;
  claimed_run: number | null;
};

function readRecovery(row: PendingRecoveryRow): Recovery {
  return row.claimed_at === null
    ? { state: RecoveryState.Queued, incident: row.incident }
    : {
        state: RecoveryState.Claimed,
        incident: row.incident,
        run: row.claimed_run!,
        at: row.claimed_at,
      };
}

export function errorFollowUpLifecycle(alert: IncidentAlert, generation: number | null) {
  return {
    state: alert.errorDue ? ErrorFollowUpState.Owed : ErrorFollowUpState.Idle,
    count: alert.errorAlerts,
    run: alert.errorRun,
    generation,
  };
}

export function reminderLifecycle(alert: IncidentAlert, generation: number | null) {
  return { run: alert.run, count: alert.reminders, generation };
}

export function recoveryAlert(
  monitorId: string,
  incident: number,
  reopenedAt: number | null,
  run: number,
  start: number,
  at: number,
  ackedBy?: string,
): Alert {
  return {
    monitorId,
    incident,
    reopenedAt,
    run,
    kind: 'recovered',
    ...(ackedBy !== undefined && { ackedBy }),
    incidentStartTime: start,
    error: '',
    alsoDown: [],
    at,
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

import * as z from 'zod/mini';
import type { CheckResult, Incident } from '@flarewatch/shared';
import { parseJson, type Sql } from './sql';

/** Failed deliveries of one down alert before the hub stops trying. */
const MAX_ALERT_ATTEMPTS = 10;
/** A failure this soon after recovering reopens the incident, so a flapping target adds no rows. */
const FLAP_SECONDS = 15 * 60;
/** Closed incidents kept per monitor, however many fit in the retention window. */
const MAX_CLOSED_INCIDENTS = 1000;
/** JSON characters of history kept per monitor, so long, changing errors cannot fill memory. */
const MAX_HISTORY_CHARS = 1_000_000;
/** An error that changes every run would otherwise grow the row past the storage limit. */
const MAX_INCIDENT_SEGMENTS = 100;
/** With the segment cap, bounds how many list parts a monitor's history can fill. */
const MAX_ERROR_CHARS = 500;
/**
 * JSON characters per list part. A UTF-16 unit takes at most 3 bytes in UTF-8,
 * so a part stays under the 2 MB row limit.
 */
const PART_CHARS = 500_000;
/** Rows importHistory reads per query, and ids per delete: a query binds at most 100 values. */
const IMPORT_PAGE = 100;

export interface IncidentUpdate {
  monitorId: string;
  statusChanged: boolean;
  changeType: 'none' | 'up' | 'down' | 'error';
  isUp: boolean;
  incidentStartTime: number;
  error: string;
}

export interface OpenIncident {
  id: number;
  monitorId: string;
  incident: Incident;
  alert: 'pending' | 'sending' | 'sent' | 'failed' | 'silent';
  alertClaimedAt: number | null;
  reopenedAt: number | null;
  /** When a reopened incident's monitor last came back up, while it waits to close. */
  upSince: number | null;
  errorAlerts: number;
}

type IncidentRow = {
  id: number;
  monitor_id: string;
  starts: string;
  errors: string;
  end_at: number | null;
  alert: OpenIncident['alert'];
  alert_claimed_at: number | null;
  reopened_at: number | null;
  up_since: number | null;
  error_alerts: number;
};

const startsSchema = z.array(z.number());
const errorsSchema = z.array(z.string());
const listSchema = z.array(
  z.object({ start: startsSchema, error: errorsSchema, end: z.optional(z.number()) }),
);

/**
 * Every incident and its alert state, plus each monitor's incidents as a JSON
 * list, so a view does not read every row.
 */
export class Incidents {
  constructor(private readonly sql: Sql) {}

  open(): Map<string, OpenIncident> {
    return new Map(
      this.sql
        .exec<IncidentRow>(
          `SELECT id, monitor_id, starts, errors, end_at, alert, alert_claimed_at, reopened_at,
             up_since, error_alerts
           FROM incidents WHERE end_at IS NULL`,
        )
        .map((row) => [
          row.monitor_id,
          {
            id: row.id,
            monitorId: row.monitor_id,
            incident: toIncident(row),
            alert: row.alert,
            alertClaimedAt: row.alert_claimed_at,
            reopenedAt: row.reopened_at,
            upSince: row.up_since,
            errorAlerts: row.error_alerts,
          },
        ]),
    );
  }

  /** Oldest incident first, per monitor. */
  byMonitor(): Map<string, Incident[]> {
    const lists = new Map<string, Incident[]>();
    for (const { monitor_id, data } of this.sql.exec<{ monitor_id: string; data: string }>(
      'SELECT monitor_id, data FROM incident_lists ORDER BY monitor_id, part',
    )) {
      const list = lists.get(monitor_id) ?? [];
      list.push(...parseList(data));
      lists.set(monitor_id, list);
    }
    return lists;
  }

  has(monitorId: string): boolean {
    return (
      this.sql.exec('SELECT 1 AS found FROM incidents WHERE monitor_id = ? LIMIT 1', monitorId)
        .length > 0
    );
  }

  apply(
    monitorId: string,
    result: CheckResult,
    open: OpenIncident | undefined,
    now: number,
  ): IncidentUpdate {
    const incidentStartTime = open?.incident.start[0] ?? now;

    if (result.ok) {
      const up = (statusChanged: boolean): IncidentUpdate => ({
        monitorId,
        statusChanged,
        changeType: statusChanged ? 'up' : 'none',
        isUp: true,
        incidentStartTime,
        error: '',
      });
      if (!open) return up(false);
      if (open.reopenedAt === null) {
        this.close(open, now);
        return up(true);
      }
      // Closes only once it stays up, so each flip writes one value.
      const upSince = open.upSince ?? now;
      if (now - upSince < FLAP_SECONDS) {
        if (open.upSince === null) {
          this.sql.exec('UPDATE incidents SET up_since = ? WHERE id = ?', now, open.id);
        }
        return up(false);
      }
      this.close(open, upSince);
      return up(true);
    }

    const error = result.error.slice(0, MAX_ERROR_CHARS);
    if (!open) {
      const [recent] = this.sql.exec<IncidentRow>(
        `SELECT id, starts, errors FROM incidents
         WHERE monitor_id = ? AND end_at >= ? ORDER BY id DESC LIMIT 1`,
        monitorId,
        now - FLAP_SECONDS,
      );
      if (recent) return this.reopen(monitorId, recent, error, now);
      this.sql.exec(
        'INSERT INTO incidents (monitor_id, starts, errors) VALUES (?, ?, ?)',
        monitorId,
        JSON.stringify([now]),
        JSON.stringify([error]),
      );
      this.setNewest(monitorId, { start: [now], error: [error] }, false);
      return {
        monitorId,
        statusChanged: true,
        changeType: 'down',
        isUp: false,
        incidentStartTime: now,
        error,
      };
    }

    // Down again during a wait to close: the grace period before a down alert
    // starts over, as at a reopen. One update, so a changing error costs one write.
    const segments = addSegment(open.incident, error, now);
    if (segments) {
      this.sql.exec(
        `UPDATE incidents SET starts = ?, errors = ?, up_since = NULL,
           reopened_at = CASE WHEN up_since IS NULL THEN reopened_at ELSE ? END
         WHERE id = ?`,
        JSON.stringify(segments.start),
        JSON.stringify(segments.error),
        now,
        open.id,
      );
      this.setNewest(monitorId, segments, true);
    } else if (open.upSince !== null) {
      this.sql.exec(
        'UPDATE incidents SET up_since = NULL, reopened_at = ? WHERE id = ?',
        now,
        open.id,
      );
    }
    return {
      monitorId,
      statusChanged: segments !== null,
      changeType: segments ? 'error' : 'none',
      isUp: false,
      incidentStartTime,
      error,
    };
  }

  close(open: OpenIncident, end: number): void {
    this.sql.exec('UPDATE incidents SET end_at = ?, up_since = NULL WHERE id = ?', end, open.id);
    this.setNewest(open.monitorId, { ...open.incident, end }, true);
    this.capClosed(open.monitorId);
  }

  /** Deletes the incidents that ended before `cutoff`. */
  expire(cutoff: number): void {
    const expired = this.sql.exec<{ monitor_id: string }>(
      'DELETE FROM incidents WHERE end_at < ? RETURNING monitor_id',
      cutoff,
    );
    for (const monitorId of new Set(expired.map((row) => row.monitor_id))) {
      this.trim(monitorId, ({ end }) => end === undefined || end >= cutoff);
    }
  }

  /**
   * Builds the lists from incidents a release before 3.2.0 recorded. Migration
   * 7 runs it once. Pages the rows and applies the caps as it goes, so an
   * oversized history never sits in memory whole.
   */
  importHistory(): void {
    const histories = new Map<
      string,
      { list: { id: number; json: string; closed: boolean }[]; closed: number; size: number }
    >();
    const dropped: number[] = [];
    let after = 0;
    for (;;) {
      const rows = this.sql.exec<IncidentRow>(
        // Errors cut here, so an older release's long ones never load whole.
        `SELECT id, monitor_id, starts, end_at,
           CASE WHEN json_valid(errors) THEN (
             SELECT json_group_array(substr(value, 1, ?)) FROM json_each(errors)
           ) ELSE '[]' END AS errors
         FROM incidents WHERE id > ? ORDER BY id LIMIT ?`,
        MAX_ERROR_CHARS,
        after,
        IMPORT_PAGE,
      );
      for (const row of rows) {
        after = row.id;
        const incident = toIncident(row);
        if (incident.start.length === 0) {
          dropped.push(row.id);
          continue;
        }
        const history = histories.get(row.monitor_id) ?? { list: [], closed: 0, size: 0 };
        histories.set(row.monitor_id, history);
        const json = JSON.stringify(incident);
        history.list.push({ id: row.id, json, closed: row.end_at !== null });
        history.size += json.length + 1;
        if (row.end_at !== null) history.closed++;
        while (history.closed > MAX_CLOSED_INCIDENTS || history.size > MAX_HISTORY_CHARS) {
          const index = history.list.findIndex(({ closed }) => closed);
          const [oldest] = index === -1 ? [] : history.list.splice(index, 1);
          if (!oldest) break;
          dropped.push(oldest.id);
          history.closed--;
          history.size -= oldest.json.length + 1;
        }
      }
      if (rows.length < IMPORT_PAGE) break;
    }
    for (let i = 0; i < dropped.length; i += IMPORT_PAGE) {
      const ids = dropped.slice(i, i + IMPORT_PAGE);
      this.sql.exec(`DELETE FROM incidents WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
    }
    for (const [monitorId, { list }] of histories) {
      const parts: string[][] = [];
      let size = 0;
      for (const { json } of list) {
        const current = parts[parts.length - 1];
        if (current && size + json.length + 1 <= PART_CHARS) {
          current.push(json);
          size += json.length + 1;
        } else {
          parts.push([json]);
          size = json.length + 2;
        }
      }
      parts.forEach((part, index) => this.writePart(monitorId, index, `[${part.join(',')}]`));
    }
  }

  /** Claimed so an overlapping run skips it, until confirm hears how delivery went. */
  claimAlert(id: number, now: number): void {
    this.sql.exec(
      "UPDATE incidents SET alert = 'sending', alert_claimed_at = ? WHERE id = ?",
      now,
      id,
    );
  }

  countErrorAlert(id: number): void {
    this.sql.exec('UPDATE incidents SET error_alerts = error_alerts + 1 WHERE id = ?', id);
  }

  /**
   * Records which down alerts reached a webhook. One that did not is due again
   * next run, until MAX_ALERT_ATTEMPTS failures. Returns the delivered ones
   * whose outage ended while they were being sent.
   */
  confirm(
    outcomes: { incident: number; delivered: boolean }[],
  ): { monitorId: string; id: number; start: number; end: number }[] {
    const ended: { monitorId: string; id: number; start: number; end: number }[] = [];
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
      const [row] = this.sql.exec<IncidentRow>(
        `UPDATE incidents SET alert = 'sent' WHERE id = ? AND alert = 'sending'
         RETURNING id, monitor_id, starts, errors, end_at`,
        incident,
      );
      if (row?.end_at != null) {
        const start = toIncident(row).start[0] ?? row.end_at;
        ended.push({ monitorId: row.monitor_id, id: row.id, start, end: row.end_at });
      }
    }
    return ended;
  }

  /**
   * The down alert is due again unless it is still waiting to go out: the
   * outage it covered ended. The grace period restarts at the reopen.
   */
  private reopen(monitorId: string, row: IncidentRow, error: string, now: number): IncidentUpdate {
    const { start, error: errors } = toIncident(row);
    const incident = { start, error: errors };
    const reopened = addSegment(incident, error, now) ?? incident;
    this.sql.exec(
      `UPDATE incidents SET end_at = NULL, reopened_at = ?, starts = ?, errors = ?, error_alerts = 0,
         alert_attempts = CASE WHEN alert IN ('pending', 'sending') THEN alert_attempts ELSE 0 END,
         alert = CASE WHEN alert IN ('pending', 'sending') THEN alert ELSE 'pending' END
       WHERE id = ?`,
      now,
      JSON.stringify(reopened.start),
      JSON.stringify(reopened.error),
      row.id,
    );
    this.setNewest(monitorId, reopened, true);
    return {
      monitorId,
      statusChanged: true,
      changeType: 'down',
      isUp: false,
      incidentStartTime: incident.start[0] ?? now,
      error,
    };
  }

  /** Puts `incident` last in the monitor's list, in place of the newest one when `replace`. */
  private setNewest(monitorId: string, incident: Incident, replace: boolean): void {
    const [last] = this.sql.exec<{ part: number; data: string }>(
      'SELECT part, data FROM incident_lists WHERE monitor_id = ? ORDER BY part DESC LIMIT 1',
      monitorId,
    );
    const part = last?.part ?? 0;
    const list = last ? parseList(last.data) : [];
    if (replace) list.pop();
    const data = JSON.stringify([...list, incident]);
    if (data.length <= PART_CHARS) {
      this.writePart(monitorId, part, data);
    } else {
      this.writePart(monitorId, part, JSON.stringify(list));
      this.writePart(monitorId, part + 1, JSON.stringify([incident]));
    }
  }

  /** Deletes the oldest closed incidents past the caps. Earliest end is oldest, so the end_at index finds them. */
  private capClosed(monitorId: string): void {
    const list = this.sql
      .exec<{ data: string }>(
        'SELECT data FROM incident_lists WHERE monitor_id = ? ORDER BY part',
        monitorId,
      )
      .flatMap(({ data }) => parseList(data));
    const sizes = list.map((incident) => JSON.stringify(incident).length + 1);
    let closed = list.filter(({ end }) => end !== undefined).length;
    let size = sizes.reduce((total, n) => total + n, 0);
    let drop = 0;
    for (const [index, incident] of list.entries()) {
      if (closed <= MAX_CLOSED_INCIDENTS && size <= MAX_HISTORY_CHARS) break;
      if (incident.end === undefined) continue;
      drop++;
      closed--;
      size -= sizes[index] ?? 0;
    }
    if (drop === 0) return;
    this.sql.exec(
      `DELETE FROM incidents WHERE id IN (
         SELECT id FROM incidents WHERE monitor_id = ? AND end_at IS NOT NULL
         ORDER BY end_at, id LIMIT ?)`,
      monitorId,
      drop,
    );
    this.trim(monitorId, (incident) => incident.end === undefined || drop-- <= 0);
  }

  /** Keeps the monitor's incidents that pass `keep`, oldest first, rewriting only the parts that change. */
  private trim(monitorId: string, keep: (incident: Incident) => boolean): void {
    for (const { part, data } of this.sql.exec<{ part: number; data: string }>(
      'SELECT part, data FROM incident_lists WHERE monitor_id = ? ORDER BY part',
      monitorId,
    )) {
      const list = parseList(data);
      const kept = list.filter(keep);
      if (kept.length === list.length) continue;
      if (kept.length > 0) {
        this.writePart(monitorId, part, JSON.stringify(kept));
      } else {
        this.sql.exec(
          'DELETE FROM incident_lists WHERE monitor_id = ? AND part = ?',
          monitorId,
          part,
        );
      }
    }
  }

  private writePart(monitorId: string, part: number, data: string): void {
    this.sql.exec(
      `INSERT INTO incident_lists (monitor_id, part, data) VALUES (?, ?, ?)
       ON CONFLICT (monitor_id, part) DO UPDATE SET data = excluded.data`,
      monitorId,
      part,
      data,
    );
  }
}

/** Errors cut as new ones are: a release before 3.2.0 stored them whole. */
function toIncident(row: Pick<IncidentRow, 'starts' | 'errors' | 'end_at'>): Incident {
  return {
    start: startsSchema.safeParse(parseJson(row.starts)).data ?? [],
    error: (errorsSchema.safeParse(parseJson(row.errors)).data ?? []).map((error) =>
      error.slice(0, MAX_ERROR_CHARS),
    ),
    ...(row.end_at !== null && { end: row.end_at }),
  };
}

function parseList(data: string): Incident[] {
  return (listSchema.safeParse(parseJson(data)).data ?? []).map(({ start, error, end }) => ({
    start,
    error,
    ...(end !== undefined && { end }),
  }));
}

/** The incident with `error` starting at `now`, or null when that is already its error. */
function addSegment(incident: Incident, error: string, now: number): Incident | null {
  if (incident.error[incident.error.length - 1] === error) return null;
  return {
    ...incident,
    start: capSegments([...incident.start, now]),
    error: capSegments([...incident.error, error]),
  };
}

/** The first segment, where the incident began, and the latest ones. */
function capSegments<T>(segments: T[]): T[] {
  const [first, ...rest] = segments;
  if (first === undefined || rest.length < MAX_INCIDENT_SEGMENTS) return segments;
  return [first, ...rest.slice(1 - MAX_INCIDENT_SEGMENTS)];
}

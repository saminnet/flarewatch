import { format, formatDistanceToNow, fromUnixTime } from 'date-fns';
import type { MonitorState } from '@flarewatch/shared';
import { formatUtc } from './date';
import { UPTIME_DAYS, UPTIME_THRESHOLDS } from './constants';

// Minimum time (in seconds) since monitor started before showing uptime data
const MIN_MONITOR_AGE_SECONDS = 60;

/**
 * Returns the "current" timestamp for calculations.
 * Uses state.lastUpdate to ensure SSR/client consistency (Date.now() would cause hydration mismatches).
 * Returns null if no state has been written yet, signaling callers to return "unknown" status.
 */
function getNowSeconds(state: MonitorState): number | null {
  return state.lastUpdate > 0 ? state.lastUpdate : null;
}

export function hasMonitorData(monitorId: string, state: MonitorState): boolean {
  const nowSec = getNowSeconds(state);
  if (nowSec === null) return false;
  const startedAt = state.startedAt?.[monitorId];
  if (!startedAt) return false;
  return nowSec - startedAt >= MIN_MONITOR_AGE_SECONDS;
}

export function calculateUptimePercent(monitorId: string, state: MonitorState): number | null {
  const nowSec = getNowSeconds(state);
  if (nowSec === null) return null;
  if (!hasMonitorData(monitorId, state)) return null;

  const incidents = state.incident[monitorId];
  if (!incidents || incidents.length === 0) return 100;
  const windowDaysAgoSec = nowSec - UPTIME_DAYS * 24 * 60 * 60;

  const monitorStartSec = state.startedAt?.[monitorId];
  const windowStartSec =
    monitorStartSec && monitorStartSec > windowDaysAgoSec ? monitorStartSec : windowDaysAgoSec;

  const totalTimeSec = nowSec - windowStartSec;
  if (totalTimeSec <= 0) return 100;

  let totalDowntimeSec = 0;

  for (const incident of incidents) {
    const firstStart = incident.start[0];
    if (firstStart === undefined) continue;
    const incidentStartSec = Math.max(firstStart, windowStartSec);
    const incidentEndSec = Math.min(incident.end ?? nowSec, nowSec);

    if (incidentEndSec > incidentStartSec) {
      totalDowntimeSec += incidentEndSec - incidentStartSec;
    }
  }

  const uptimePercent = ((totalTimeSec - totalDowntimeSec) / totalTimeSec) * 100;

  return Math.max(0, Math.min(100, uptimePercent));
}

export function isMonitorUp(monitorId: string, state: MonitorState): boolean {
  const incidents = state.incident[monitorId];
  if (!incidents || incidents.length === 0) return true;

  const lastIncident = incidents[incidents.length - 1];
  if (!lastIncident) return true;
  return lastIncident.end !== undefined;
}

export function getMonitorError(monitorId: string, state: MonitorState): string | null {
  const incidents = state.incident[monitorId];
  if (!incidents || incidents.length === 0) return null;

  const lastIncident = incidents[incidents.length - 1];
  if (!lastIncident || lastIncident.end !== undefined) return null;

  const lastError = lastIncident.error[lastIncident.error.length - 1];
  return lastError ?? 'Unknown error';
}

export function getLatestLatency(
  monitorId: string,
  state: MonitorState,
): { ping: number; loc: string; time: number } | null {
  const latency = state.latency[monitorId];
  if (!latency || !latency.recent || latency.recent.length === 0) return null;

  const lastRecord = latency.recent[latency.recent.length - 1];
  return lastRecord ?? null;
}

export function formatTimestamp(timestamp: number): string {
  return format(fromUnixTime(timestamp), 'PPpp');
}

export function formatUptimeDisplay(
  uptimePercent: number | null,
  hasStarted: boolean,
  decimals: number,
  t: (key: 'monitor.starting' | 'monitor.pending') => string,
): string {
  if (uptimePercent !== null) {
    return `${uptimePercent.toFixed(decimals)}%`;
  }
  return hasStarted ? t('monitor.starting') : t('monitor.pending');
}

export function formatRelativeTime(timestamp: number): string {
  return formatDistanceToNow(fromUnixTime(timestamp), { addSuffix: true });
}

export function getOverallStatus(state: MonitorState): 'operational' | 'degraded' | 'down' {
  if (state.overallDown === 0) return 'operational';
  if (state.overallUp > 0) return 'degraded';
  return 'down';
}

export interface DayIncidentDetail {
  startTime: string;
  endTime: string;
  error: string;
}

export interface DailyStatusData {
  date: Date;
  status: 'up' | 'down' | 'partial' | 'unknown';
  uptime: number;
  downtime: number;
  incidents: DayIncidentDetail[];
}

function createUnknownDay(date: Date): DailyStatusData {
  return { date, status: 'unknown', uptime: 100, downtime: 0, incidents: [] };
}

function generateUnknownDays(baseDate: Date): DailyStatusData[] {
  const days: DailyStatusData[] = [];
  for (let i = UPTIME_DAYS - 1; i >= 0; i--) {
    const date = new Date(baseDate);
    date.setUTCDate(date.getUTCDate() - i);
    date.setUTCHours(0, 0, 0, 0);
    days.push(createUnknownDay(date));
  }
  return days;
}

export function generateDailyStatus(monitorId: string, state: MonitorState): DailyStatusData[] {
  const days: DailyStatusData[] = [];
  const nowSec = getNowSeconds(state);

  // No state data yet - return unknown days based on current UTC date
  if (nowSec === null) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return generateUnknownDays(today);
  }

  const nowMs = nowSec * 1000;
  const now = new Date(nowMs);
  const incidents = state.incident[monitorId] || [];
  const monitorStartSec = state.startedAt?.[monitorId];

  // If monitor has no data yet, return all unknown days
  if (!hasMonitorData(monitorId, state)) {
    return generateUnknownDays(now);
  }

  for (let i = UPTIME_DAYS - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() - i);
    date.setUTCHours(0, 0, 0, 0);

    const dayStart = date.getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;
    const dayStartSec = Math.floor(dayStart / 1000);
    const dayEndSec = Math.floor(dayEnd / 1000);

    // Entire day is before monitoring began
    if (monitorStartSec && dayEndSec <= monitorStartSec) {
      days.push(createUnknownDay(date));
      continue;
    }

    const effectiveDayStartSec = monitorStartSec
      ? Math.max(dayStartSec, monitorStartSec)
      : dayStartSec;
    const effectiveDayEndSec = Math.min(dayEndSec, nowSec);
    const effectiveDayStartMs = effectiveDayStartSec * 1000;
    const effectiveDayEndMs = effectiveDayEndSec * 1000;

    let downtimeInDay = 0;
    const dayIncidents: DayIncidentDetail[] = [];

    for (const incident of incidents) {
      const incidentStart = incident.start[0];
      if (incidentStart === undefined) continue;
      const incidentEnd = incident.end ?? nowSec;

      // Check if incident overlaps with this day
      if (incidentEnd > effectiveDayStartSec && incidentStart < effectiveDayEndSec) {
        const overlapStart = Math.max(incidentStart, effectiveDayStartSec);
        const overlapEnd = Math.min(incidentEnd, effectiveDayEndSec);
        downtimeInDay += (overlapEnd - overlapStart) * 1000;

        // Collect incident details for this day
        for (let j = 0; j < incident.error.length; j++) {
          const partStart = incident.start[j];
          if (partStart === undefined) continue;
          const nextStart = incident.start[j + 1];
          const partEnd =
            j === incident.error.length - 1 ? (incident.end ?? nowSec) : (nextStart ?? nowSec);

          // Check if this part overlaps with the day
          if (partEnd > effectiveDayStartSec && partStart < effectiveDayEndSec) {
            const clampedStart = Math.max(partStart, effectiveDayStartSec);
            const clampedEnd = Math.min(partEnd, effectiveDayEndSec);
            const errorMsg = incident.error[j];

            dayIncidents.push({
              startTime: formatUtc(new Date(clampedStart * 1000), 'HH:mm'),
              endTime: formatUtc(new Date(clampedEnd * 1000), 'HH:mm'),
              error: errorMsg ?? 'Unknown error',
            });
          }
        }
      }
    }

    const dayDuration = effectiveDayEndMs - effectiveDayStartMs;
    const uptimePercent =
      dayDuration > 0 ? ((dayDuration - downtimeInDay) / dayDuration) * 100 : 100;

    let status: 'up' | 'down' | 'partial' | 'unknown';
    if (dayStart > nowMs || effectiveDayEndSec <= effectiveDayStartSec) {
      status = 'unknown';
    } else if (uptimePercent >= UPTIME_THRESHOLDS.EXCELLENT) {
      status = 'up';
    } else if (uptimePercent >= UPTIME_THRESHOLDS.PARTIAL) {
      status = 'partial';
    } else {
      status = 'down';
    }

    days.push({
      date,
      status,
      uptime: uptimePercent,
      downtime: downtimeInDay,
      incidents: dayIncidents,
    });
  }

  return days;
}

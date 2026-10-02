import {
  coversMonitor,
  maintenanceOccurrences,
  nextMaintenanceOccurrence,
  type Maintenance,
  type StatusView,
} from '@flarewatch/shared';
import type { IncidentEvent, MaintenanceEvent, TimelineEvent } from '@/components/history/types';
import type { PublicMonitor } from '@/lib/public-view';
import { getMaintenanceStatus } from '@/lib/maintenance';
import { countStatuses, monitorState, type MonitorState } from '@/lib/monitor-state';
import { getLatestLatency, getMonitorError } from '@/lib/uptime';

const SECOND_MS = 1000;

type PublicDataMonitor = {
  up: boolean;
  status: MonitorState;
  latency: number | null;
  location: string | null;
  message: string;
};

type PublicDataProjection = {
  up: number;
  down: number;
  updatedAt: number;
  monitors: Record<string, PublicDataMonitor>;
};

type BadgeStatusProjection = { status: 'unknown' | 'up' | 'degraded' | 'down' };

type TimelineEventType = 'incident' | 'maintenance' | 'all';

type TimelineProjectionInput = {
  state: StatusView | null;
  monitors: PublicMonitor[];
  maintenances: Maintenance[];
  monthStart: Date;
  monthEnd: Date;
  nowMs: number;
  selectedMonitor?: string | undefined;
  eventType?: TimelineEventType | undefined;
  /** Of a window's future runs, list only the next one: for a range with no real end. */
  nextRunOnly?: boolean | undefined;
};

type TimelineProjection = {
  pinned: MaintenanceEvent[];
  timeline: TimelineEvent[];
};

function getEventStartMs(event: TimelineEvent): number {
  return event.type === 'incident' ? event.start * SECOND_MS : event.occurrence.start;
}

export function projectPublicData(
  monitors: PublicMonitor[],
  state: StatusView,
  maintenances: Maintenance[],
): PublicDataProjection {
  const projectedMonitors: Record<string, PublicDataMonitor> = {};

  for (const monitor of monitors) {
    const latestLatency = getLatestLatency(monitor.id, state);
    const status = monitorState(monitor, state, maintenances);
    const up = status !== 'down';
    const error = getMonitorError(monitor.id, state);

    projectedMonitors[monitor.id] = {
      up,
      status,
      latency: latestLatency?.ping ?? null,
      location: latestLatency?.loc ?? null,
      message: up ? 'OK' : (error ?? 'Unknown error'),
    };
  }

  const { up, late, slow, down } = countStatuses(monitors, state, maintenances);
  return {
    up: up + late + slow,
    down,
    updatedAt: state.lastUpdate,
    monitors: projectedMonitors,
  };
}

/** Unknown until the monitor's first check result. Pending and running jobs show as up. */
export function projectBadgeStatus(
  monitor: PublicMonitor,
  state: StatusView,
  maintenances: Maintenance[],
): BadgeStatusProjection {
  if (state.monitors[monitor.id]?.startedAt === undefined) return { status: 'unknown' };
  const shown = monitorState(monitor, state, maintenances);
  return { status: shown === 'down' || shown === 'degraded' ? shown : 'up' };
}

function projectIncidentEvents(
  state: StatusView | null,
  monitors: PublicMonitor[],
  monthStart: Date,
  monthEnd: Date,
  nowMs: number,
): IncidentEvent[] {
  if (!state) return [];

  const events: IncidentEvent[] = [];
  const monthStartSec = Math.floor(monthStart.getTime() / SECOND_MS);
  const monthEndSec = Math.floor(monthEnd.getTime() / SECOND_MS);
  const nowSec = state.lastUpdate > 0 ? state.lastUpdate : Math.floor(nowMs / SECOND_MS);

  for (const monitor of monitors) {
    const incidents = state.monitors[monitor.id]?.incidents;
    if (!incidents) continue;

    for (const incident of incidents) {
      const startTime = incident.start[0];
      if (startTime === undefined) continue;

      const endTime = incident.end;
      const incidentStart = startTime;
      const incidentEnd = endTime ?? nowSec;

      if (incidentEnd < monthStartSec || incidentStart > monthEndSec) {
        continue;
      }

      events.push({
        type: 'incident',
        monitorId: monitor.id,
        monitorName: monitor.name,
        start: startTime,
        end: endTime,
        errors: incident.error,
      });
    }
  }

  return events;
}

function projectMaintenanceEvents(
  maintenances: Maintenance[],
  monthStart: Date,
  monthEnd: Date,
  nowMs: number,
  nextRunOnly: boolean,
): MaintenanceEvent[] {
  return maintenances.flatMap((maintenance) => {
    const next = nextMaintenanceOccurrence(maintenance, nowMs);
    const to = nextRunOnly
      ? Math.min(monthEnd.getTime(), next?.start ?? nowMs)
      : monthEnd.getTime();
    return maintenanceOccurrences(maintenance, monthStart.getTime(), to).map(
      (occurrence): MaintenanceEvent => ({ type: 'maintenance', maintenance, occurrence }),
    );
  });
}

export function projectTimeline(input: TimelineProjectionInput): TimelineProjection {
  const incidentEvents = projectIncidentEvents(
    input.state,
    input.monitors,
    input.monthStart,
    input.monthEnd,
    input.nowMs,
  );
  const maintenanceEvents = projectMaintenanceEvents(
    input.maintenances,
    input.monthStart,
    input.monthEnd,
    input.nowMs,
    input.nextRunOnly ?? false,
  );
  let events: TimelineEvent[] = [...incidentEvents, ...maintenanceEvents];

  if (input.eventType === 'incident') {
    events = events.filter((event) => event.type === 'incident');
  } else if (input.eventType === 'maintenance') {
    events = events.filter((event) => event.type === 'maintenance');
  }

  const selectedMonitor = input.selectedMonitor;
  if (selectedMonitor) {
    events = events.filter((event) => {
      if (event.type === 'incident') {
        return event.monitorId === selectedMonitor;
      }
      return coversMonitor(event.maintenance, selectedMonitor);
    });
  }

  const sortedEvents = events.sort((a, b) => getEventStartMs(b) - getEventStartMs(a));
  const pinned: MaintenanceEvent[] = [];
  const timeline: TimelineEvent[] = [];

  if ((input.eventType ?? 'all') === 'all') {
    for (const event of sortedEvents) {
      if (event.type === 'maintenance') {
        const { maintenance, occurrence } = event;
        const status = getMaintenanceStatus(maintenance, input.nowMs, occurrence);
        // A repeating window pins its current or next run; its later runs stay in the timeline.
        const isNext =
          nextMaintenanceOccurrence(maintenance, input.nowMs)?.start === occurrence.start;
        if (isNext && (status === 'active' || status === 'upcoming')) {
          pinned.push(event);
          continue;
        }
      }
      timeline.push(event);
    }
  } else {
    timeline.push(...sortedEvents);
  }

  return { pinned, timeline };
}

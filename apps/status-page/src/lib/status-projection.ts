import type { Maintenance, MonitorState, MonitorTarget } from '@flarewatch/shared';
import type { IncidentEvent, MaintenanceEvent, TimelineEvent } from '@/components/events/types';
import type { PublicMonitor } from '@/lib/monitors';
import { getMaintenanceStatus } from '@/lib/maintenance';
import { getLatestLatency, getMonitorError, isMonitorUp } from '@/lib/uptime';

const SECOND_MS = 1000;

type PublicDataMonitor = {
  up: boolean;
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

type BadgeStatusProjection = { status: 'unknown' } | { status: 'known'; up: boolean };

type TimelineEventType = 'incident' | 'maintenance' | 'all';

type TimelineProjectionInput = {
  state: MonitorState | null;
  monitors: PublicMonitor[];
  maintenances: Maintenance[];
  monthStart: Date;
  monthEnd: Date;
  nowMs: number;
  selectedMonitor?: string | undefined;
  eventType?: TimelineEventType | undefined;
};

type TimelineProjection = {
  pinned: MaintenanceEvent[];
  timeline: TimelineEvent[];
};

function getEventStartMs(event: TimelineEvent): number {
  return event.type === 'incident'
    ? event.start * SECOND_MS
    : new Date(event.maintenance.start).getTime();
}

export function projectPublicData(
  monitors: MonitorTarget[],
  state: MonitorState,
): PublicDataProjection {
  const projectedMonitors: Record<string, PublicDataMonitor> = {};

  for (const monitor of monitors) {
    const latestLatency = getLatestLatency(monitor.id, state);
    const up = isMonitorUp(monitor.id, state);
    const error = getMonitorError(monitor.id, state);

    projectedMonitors[monitor.id] = {
      up,
      latency: latestLatency?.ping ?? null,
      location: latestLatency?.loc ?? null,
      message: up ? 'OK' : (error ?? 'Unknown error'),
    };
  }

  return {
    up: state.overallUp,
    down: state.overallDown,
    updatedAt: state.lastUpdate,
    monitors: projectedMonitors,
  };
}

export function projectBadgeStatus(monitorId: string, state: MonitorState): BadgeStatusProjection {
  const hasIncidentHistory = Boolean(state.incident?.[monitorId]);
  const hasLatencyData = Boolean(state.latency?.[monitorId]?.recent?.length);

  if (!hasIncidentHistory || !hasLatencyData) {
    return { status: 'unknown' };
  }

  return { status: 'known', up: isMonitorUp(monitorId, state) };
}

function projectIncidentEvents(
  state: MonitorState | null,
  monitors: PublicMonitor[],
  monthStart: Date,
  monthEnd: Date,
): IncidentEvent[] {
  if (!state) return [];

  const events: IncidentEvent[] = [];
  const monthStartSec = Math.floor(monthStart.getTime() / SECOND_MS);
  const monthEndSec = Math.floor(monthEnd.getTime() / SECOND_MS);
  const nowSec = state.lastUpdate > 0 ? state.lastUpdate : Math.floor(Date.now() / SECOND_MS);

  for (const monitor of monitors) {
    const incidents = state.incident[monitor.id];
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
): MaintenanceEvent[] {
  const events: MaintenanceEvent[] = [];
  const monthStartMs = monthStart.getTime();
  const monthEndMs = monthEnd.getTime();

  for (const maintenance of maintenances) {
    const start = new Date(maintenance.start);
    const end = maintenance.end ? new Date(maintenance.end) : null;
    const startTime = start.getTime();
    const endTime = end?.getTime() ?? Infinity;

    if (endTime >= monthStartMs && startTime <= monthEndMs) {
      events.push({ type: 'maintenance', maintenance });
    }
  }

  return events;
}

export function projectTimeline(input: TimelineProjectionInput): TimelineProjection {
  const incidentEvents = projectIncidentEvents(
    input.state,
    input.monitors,
    input.monthStart,
    input.monthEnd,
  );
  const maintenanceEvents = projectMaintenanceEvents(
    input.maintenances,
    input.monthStart,
    input.monthEnd,
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
      return event.maintenance.monitors?.includes(selectedMonitor) ?? false;
    });
  }

  const sortedEvents = events.sort((a, b) => getEventStartMs(b) - getEventStartMs(a));
  const pinned: MaintenanceEvent[] = [];
  const timeline: TimelineEvent[] = [];

  if ((input.eventType ?? 'all') === 'all') {
    for (const event of sortedEvents) {
      if (event.type === 'maintenance') {
        const status = getMaintenanceStatus(event.maintenance, input.nowMs);
        if (status === 'active' || status === 'upcoming') {
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

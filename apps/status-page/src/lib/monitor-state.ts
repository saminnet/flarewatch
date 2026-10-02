import {
  coversMonitor,
  isMaintenanceActive,
  type LatencySample,
  type Maintenance,
  type StatusView,
} from '@flarewatch/shared';
import type { PublicMonitor } from '@/lib/public-view';

/** What the page shows for a monitor: its icon, the banner, the API, the badge and the embed. */
export type MonitorState = 'up' | 'degraded' | 'down' | 'pending' | 'running';

type StateMonitor = Pick<PublicMonitor, 'id' | 'method' | 'maxLatencyMs'>;

/**
 * Down means an open incident, as the hub decides. A late job, or a check
 * slower than its maxLatencyMs, is degraded. A monitor without data, or a job
 * that never pinged, is pending.
 */
export function monitorState(
  monitor: StateMonitor,
  state: StatusView,
  maintenances: Maintenance[],
): MonitorState {
  const view = state.monitors[monitor.id];
  if (!view) return 'pending';
  if (view.status === 'down') return 'down';
  if (monitor.method === 'HEARTBEAT' && !view.heartbeat) return 'pending';
  if (view.status === 'late') return 'degraded';
  if (isSlow(monitor, view.latest, maintenances)) return 'degraded';
  return view.status;
}

/** A maintenance window that covers the monitor when the sample was taken excuses it. */
function isSlow(
  monitor: StateMonitor,
  latest: LatencySample | undefined,
  maintenances: Maintenance[],
): boolean {
  if (monitor.maxLatencyMs === undefined || !latest || latest.ping <= monitor.maxLatencyMs) {
    return false;
  }
  return !maintenances.some(
    (maintenance) =>
      coversMonitor(maintenance, monitor.id) &&
      isMaintenanceActive(maintenance, latest.time * 1000),
  );
}

export type StatusCounts = { up: number; late: number; slow: number; down: number };

/** Monitors the hub has no data for are left out. Pending and running count as up. */
export function countStatuses(
  monitors: StateMonitor[],
  state: StatusView,
  maintenances: Maintenance[],
): StatusCounts {
  const counts: StatusCounts = { up: 0, late: 0, slow: 0, down: 0 };
  for (const monitor of monitors) {
    if (!state.monitors[monitor.id]) continue;
    const shown = monitorState(monitor, state, maintenances);
    if (shown === 'down') counts.down++;
    else if (shown !== 'degraded') counts.up++;
    else if (monitor.method === 'HEARTBEAT') counts.late++;
    else counts.slow++;
  }
  return counts;
}

export function getOverallStatus({
  up,
  late,
  slow,
  down,
}: StatusCounts): 'operational' | 'degraded' | 'down' {
  if (down === 0) return late + slow > 0 ? 'degraded' : 'operational';
  if (up + late + slow > 0) return 'degraded';
  return 'down';
}

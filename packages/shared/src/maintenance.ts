import type { Maintenance } from './types';

/** A window runs from its start up to, not including, its end. With no end it runs on. */
export function isMaintenanceActive(maintenance: Maintenance, nowMs: number): boolean {
  const startMs = new Date(maintenance.start).getTime();
  const endMs = maintenance.end ? new Date(maintenance.end).getTime() : undefined;
  return startMs <= nowMs && (endMs === undefined || endMs > nowMs);
}

/** A window that lists no monitors covers every monitor. */
export function coversMonitor(maintenance: Maintenance, monitorId: string): boolean {
  return !maintenance.monitors?.length || maintenance.monitors.includes(monitorId);
}

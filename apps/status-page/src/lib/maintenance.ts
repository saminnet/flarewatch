import type { Maintenance } from '@flarewatch/shared';
import { TIME_MS, UPCOMING_MAINTENANCE_DAYS } from './constants';
import { formatUtc, formatDuration } from './date';

function isMaintenanceActive(maintenance: Maintenance, now = Date.now()): boolean {
  const startMs = new Date(maintenance.start).getTime();
  const endMs = maintenance.end ? new Date(maintenance.end).getTime() : undefined;
  return startMs <= now && (endMs === undefined || endMs > now);
}

function isMaintenanceUpcoming(
  maintenance: Maintenance,
  now = Date.now(),
  daysAhead = UPCOMING_MAINTENANCE_DAYS,
): boolean {
  const startMs = new Date(maintenance.start).getTime();
  const futureMs = now + daysAhead * TIME_MS.DAY;
  return startMs > now && startMs <= futureMs;
}

function isMaintenancePast(maintenance: Maintenance, now = Date.now()): boolean {
  const endMs = maintenance.end ? new Date(maintenance.end).getTime() : undefined;
  return endMs !== undefined && endMs <= now;
}

export function getMaintenanceStatus(
  maintenance: Maintenance,
  now = Date.now(),
): 'active' | 'upcoming' | 'scheduled' | 'past' {
  if (isMaintenanceActive(maintenance, now)) return 'active';
  if (isMaintenancePast(maintenance, now)) return 'past';
  if (isMaintenanceUpcoming(maintenance, now)) return 'upcoming';
  return 'scheduled';
}

export interface FilteredMaintenances {
  active: Maintenance[];
  upcoming: Maintenance[];
  past: Maintenance[];
}

/** ISO 8601 strings sort lexicographically — no Date parsing needed. */
export function compareByStart(a: Maintenance, b: Maintenance): number {
  return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
}

export function filterMaintenances(
  maintenances: Maintenance[],
  options?: { upcomingDays?: number; nowMs?: number },
): FilteredMaintenances {
  const now = options?.nowMs ?? Date.now();
  const upcomingDays = options?.upcomingDays ?? UPCOMING_MAINTENANCE_DAYS;

  const active: Maintenance[] = [];
  const upcoming: Maintenance[] = [];
  const past: Maintenance[] = [];

  for (const m of maintenances) {
    if (isMaintenanceActive(m, now)) {
      active.push(m);
    } else if (isMaintenancePast(m, now)) {
      past.push(m);
    } else if (isMaintenanceUpcoming(m, now, upcomingDays)) {
      upcoming.push(m);
    }
  }

  active.sort(compareByStart);
  upcoming.sort(compareByStart);
  past.sort((a, b) => compareByStart(b, a)); // newest first

  return { active, upcoming, past };
}

export function formatTimeUntil(date: Date, now = new Date()): string {
  const diffMs = date.getTime() - now.getTime();
  return formatDuration(diffMs, { minUnit: 'minutes' });
}

export function formatDateRange(start: Date, end: Date | null): string {
  const pattern = 'MMM d, HH:mm';
  const startStr = formatUtc(start, pattern);
  if (!end) return startStr;
  const endStr = formatUtc(end, pattern);
  return `${startStr} - ${endStr}`;
}

export type MaintenanceColors = {
  bg: string;
  border: string;
  icon: string;
  dot: string;
};

const MAINTENANCE_COLOR_MAP: Record<string, MaintenanceColors> = {
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-800',
    icon: 'text-blue-500',
    dot: 'bg-blue-500',
  },
  yellow: {
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-800',
    icon: 'text-amber-500',
    dot: 'bg-amber-500',
  },
  red: {
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-200 dark:border-red-800',
    icon: 'text-red-500',
    dot: 'bg-red-500',
  },
  green: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    border: 'border-emerald-200 dark:border-emerald-800',
    icon: 'text-emerald-500',
    dot: 'bg-emerald-500',
  },
};

/**
 * Default surface for maintenances with no authored severity color — backed by the
 * `--status-maintenance-*` runtime tokens. Authored severity colors keep the palette above.
 */
const DEFAULT_MAINTENANCE_COLORS: MaintenanceColors = {
  bg: 'bg-status-maintenance-bg',
  border: 'border-status-maintenance-border',
  icon: 'text-status-maintenance',
  dot: 'bg-status-maintenance',
};

export function getMaintenanceColors(color?: string): MaintenanceColors {
  if (!color) return DEFAULT_MAINTENANCE_COLORS;
  return MAINTENANCE_COLOR_MAP[color] ?? DEFAULT_MAINTENANCE_COLORS;
}

export const SEVERITY_OPTIONS = [
  {
    value: 'green',
    labelKey: 'severity.minor',
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  {
    value: 'yellow',
    labelKey: 'event.maintenance',
    badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  },
  {
    value: 'blue',
    labelKey: 'severity.info',
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  },
  {
    value: 'red',
    labelKey: 'severity.critical',
    badge: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  },
] as const;

export type SeverityOption = (typeof SEVERITY_OPTIONS)[number];

export function getSeverityOption(color?: string): SeverityOption {
  return SEVERITY_OPTIONS.find((s) => s.value === color) ?? SEVERITY_OPTIONS[1];
}

export function resolveAffectedMonitors<T extends { id: string }>(
  monitorIds: string[] | undefined,
  monitors: T[],
): T[] {
  if (!monitorIds) return [];
  return monitorIds
    .map((id) => monitors.find((m) => m.id === id))
    .filter((m): m is T => m !== undefined);
}

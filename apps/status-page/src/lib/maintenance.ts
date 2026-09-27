import { formatUtcShort, type Maintenance } from '@flarewatch/shared';
import { TIME_MS, UPCOMING_MAINTENANCE_DAYS } from './constants';
import { formatUtc, formatDuration, getDateKey } from './date';

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

interface FilteredMaintenances {
  active: Maintenance[];
  upcoming: Maintenance[];
  past: Maintenance[];
}

export function compareByStart(a: Maintenance, b: Maintenance): number {
  return new Date(a.start).getTime() - new Date(b.start).getTime();
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
  if (!end) return formatUtcShort(start.getTime() / 1000);
  if (getDateKey(start) === getDateKey(end)) {
    return `${formatUtc(start, 'MMM d, HH:mm')}–${formatUtc(end, "HH:mm 'UTC'")}`;
  }
  return `${formatUtc(start, 'MMM d, HH:mm')} – ${formatUtcShort(end.getTime() / 1000)}`;
}

type MaintenanceColors = {
  bg: string;
  border: string;
  icon: string;
  dot: string;
};

type MaintenanceColorName = 'blue' | 'yellow' | 'red' | 'green';

const MAINTENANCE_COLOR_MAP = {
  blue: {
    bg: 'bg-status-maintenance-bg',
    border: 'border-status-maintenance-border',
    icon: 'text-status-maintenance',
    dot: 'bg-status-maintenance',
  },
  yellow: {
    bg: 'bg-status-degraded-bg',
    border: 'border-status-degraded-border',
    icon: 'text-status-degraded-text',
    dot: 'bg-status-degraded',
  },
  red: {
    bg: 'bg-status-down-bg',
    border: 'border-status-down-border',
    icon: 'text-status-down-text',
    dot: 'bg-status-down',
  },
  green: {
    bg: 'bg-status-unknown-bg',
    border: 'border-status-unknown-border',
    icon: 'text-muted-foreground',
    dot: 'bg-status-unknown',
  },
} satisfies Record<MaintenanceColorName, MaintenanceColors>;

function isMaintenanceColorName(value: string): value is MaintenanceColorName {
  return value in MAINTENANCE_COLOR_MAP;
}

/** Default for maintenances with no authored severity color; authored colors keep the palette above. */
const DEFAULT_MAINTENANCE_COLORS: MaintenanceColors = {
  bg: 'bg-status-maintenance-bg',
  border: 'border-status-maintenance-border',
  icon: 'text-status-maintenance',
  dot: 'bg-status-maintenance',
};

export function getMaintenanceColors(color?: string): MaintenanceColors {
  if (!color || !isMaintenanceColorName(color)) return DEFAULT_MAINTENANCE_COLORS;
  return MAINTENANCE_COLOR_MAP[color];
}

export const SEVERITY_OPTIONS = [
  {
    value: 'green',
    label: 'Minor',
    badge: 'bg-status-unknown-bg text-muted-foreground',
  },
  {
    value: 'yellow',
    label: 'Maintenance',
    badge: 'bg-status-degraded-bg text-status-degraded-text',
  },
  {
    value: 'blue',
    label: 'Info',
    badge: 'bg-status-maintenance-bg text-status-maintenance',
  },
  {
    value: 'red',
    label: 'Critical',
    badge: 'bg-status-down-bg text-status-down-text',
  },
] as const;

type SeverityOption = (typeof SEVERITY_OPTIONS)[number];

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

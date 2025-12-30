import type { Maintenance } from '@flarewatch/shared';
import { TIME_MS, UPCOMING_MAINTENANCE_DAYS } from './constants';
import { formatUtc } from './date';

// ============================================================================
// Status Functions
// ============================================================================

/**
 * Check if a maintenance is currently active
 */
export function isMaintenanceActive(maintenance: Maintenance, now = Date.now()): boolean {
  const startMs = new Date(maintenance.start).getTime();
  const endMs = maintenance.end ? new Date(maintenance.end).getTime() : undefined;
  return startMs <= now && (endMs === undefined || endMs > now);
}

/**
 * Check if a maintenance is upcoming (within configured days)
 */
export function isMaintenanceUpcoming(
  maintenance: Maintenance,
  now = Date.now(),
  daysAhead = UPCOMING_MAINTENANCE_DAYS,
): boolean {
  const startMs = new Date(maintenance.start).getTime();
  const futureMs = now + daysAhead * TIME_MS.DAY;
  return startMs > now && startMs <= futureMs;
}

/**
 * Check if a maintenance is past (completed)
 */
export function isMaintenancePast(maintenance: Maintenance, now = Date.now()): boolean {
  const endMs = maintenance.end ? new Date(maintenance.end).getTime() : undefined;
  return endMs !== undefined && endMs <= now;
}

/**
 * Get maintenance status
 */
export function getMaintenanceStatus(
  maintenance: Maintenance,
  now = Date.now(),
): 'active' | 'upcoming' | 'past' {
  if (isMaintenanceActive(maintenance, now)) return 'active';
  if (isMaintenancePast(maintenance, now)) return 'past';
  return 'upcoming';
}

// ============================================================================
// Filtering & Sorting
// ============================================================================

export interface FilteredMaintenances {
  active: Maintenance[];
  upcoming: Maintenance[];
  past: Maintenance[];
}

/**
 * Filter and sort maintenances by status
 */
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

  // Sort by start time
  const sortByStart = (a: Maintenance, b: Maintenance) =>
    new Date(a.start).getTime() - new Date(b.start).getTime();

  active.sort(sortByStart);
  upcoming.sort(sortByStart);
  past.sort((a, b) => sortByStart(b, a)); // Past sorted newest first

  return { active, upcoming, past };
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format time until a date (e.g., "2d 5h", "3h 20m", "45m")
 */
export function formatTimeUntil(date: Date, now = new Date()): string {
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / TIME_MS.MINUTE);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays}d ${diffHours % 24}h`;
  }
  if (diffHours > 0) {
    return `${diffHours}h ${diffMins % 60}m`;
  }
  return `${diffMins}m`;
}

/**
 * Format a date range for display
 */
export function formatDateRange(start: Date, end: Date | null): string {
  const pattern = 'MMM d, HH:mm';
  const startStr = formatUtc(start, pattern);
  if (!end) return startStr;
  const endStr = formatUtc(end, pattern);
  return `${startStr} - ${endStr}`;
}

// ============================================================================
// Colors
// ============================================================================

export type MaintenanceColors = {
  bg: string;
  border: string;
  icon: string;
};

const DEFAULT_MAINTENANCE_COLOR: MaintenanceColors = {
  bg: 'bg-blue-50 dark:bg-blue-950/30',
  border: 'border-blue-200 dark:border-blue-800',
  icon: 'text-blue-500',
};

const MAINTENANCE_COLOR_MAP: Record<string, MaintenanceColors> = {
  blue: DEFAULT_MAINTENANCE_COLOR,
  yellow: {
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-800',
    icon: 'text-amber-500',
  },
  red: {
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-200 dark:border-red-800',
    icon: 'text-red-500',
  },
  green: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    border: 'border-emerald-200 dark:border-emerald-800',
    icon: 'text-emerald-500',
  },
};

/**
 * Get maintenance color classes based on color name
 */
export function getMaintenanceColors(color?: string): MaintenanceColors {
  return MAINTENANCE_COLOR_MAP[color ?? 'blue'] ?? DEFAULT_MAINTENANCE_COLOR;
}

/**
 * Get border color class for events list (combined border + bg)
 */
export function getMaintenanceBorderClass(color?: string): string {
  const colorMap: Record<string, string> = {
    blue: 'border-blue-500 bg-blue-50 dark:bg-blue-950/30',
    yellow: 'border-amber-500 bg-amber-50 dark:bg-amber-950/30',
    red: 'border-red-500 bg-red-50 dark:bg-red-950/30',
    green: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30',
  };
  const defaultColor = 'border-amber-500 bg-amber-50 dark:bg-amber-950/30';
  return colorMap[color ?? 'yellow'] ?? defaultColor;
}

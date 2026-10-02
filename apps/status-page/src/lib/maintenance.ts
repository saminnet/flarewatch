import {
  formatUtcShort,
  nextMaintenanceOccurrence,
  occurrencePhase,
  type Maintenance,
  type MaintenanceRepeat,
  type Occurrence,
} from '@flarewatch/shared';
import { TIME_MS, UPCOMING_MAINTENANCE_DAYS } from './constants';
import { formatUtc, formatDuration, getDateKey } from './date';

/** Of the given run, by default the window's current or next one. */
export function getMaintenanceStatus(
  maintenance: Maintenance,
  now: number,
  occurrence = nextMaintenanceOccurrence(maintenance, now),
): 'active' | 'upcoming' | 'scheduled' | 'past' {
  if (!occurrence) return 'past';
  const phase = occurrencePhase(occurrence, now);
  if (phase !== 'upcoming') return phase;
  return occurrence.start <= now + UPCOMING_MAINTENANCE_DAYS * TIME_MS.DAY
    ? 'upcoming'
    : 'scheduled';
}

export function occurrenceDates(occurrence: Occurrence) {
  return {
    start: new Date(occurrence.start),
    end: occurrence.end === Infinity ? null : new Date(occurrence.end),
  };
}

interface FilteredMaintenances {
  active: Maintenance[];
  upcoming: Maintenance[];
  past: Maintenance[];
}

export function compareByStart(a: Maintenance, b: Maintenance): number {
  return new Date(a.start).getTime() - new Date(b.start).getTime();
}

type Dated = { maintenance: Maintenance; start: number };

function byStart(list: Dated[]): Maintenance[] {
  return list.sort((a, b) => a.start - b.start).map(({ maintenance }) => maintenance);
}

/** Active and upcoming by their current or next run, past newest first. */
export function filterMaintenances(
  maintenances: Maintenance[],
  options?: { upcomingDays?: number; nowMs?: number },
): FilteredMaintenances {
  const now = options?.nowMs ?? Date.now();
  const upcomingDays = options?.upcomingDays ?? UPCOMING_MAINTENANCE_DAYS;

  const active: Dated[] = [];
  const upcoming: Dated[] = [];
  const past: Maintenance[] = [];

  for (const maintenance of maintenances) {
    const next = nextMaintenanceOccurrence(maintenance, now);
    if (!next) {
      past.push(maintenance);
    } else if (next.start <= now) {
      active.push({ maintenance, start: next.start });
    } else if (next.start <= now + upcomingDays * TIME_MS.DAY) {
      upcoming.push({ maintenance, start: next.start });
    }
  }

  past.sort((a, b) => compareByStart(b, a));
  return { active: byStart(active), upcoming: byStart(upcoming), past };
}

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const REPEAT_OPTIONS = [
  { value: '', label: 'Does not repeat' },
  { value: 'day', label: 'Every day' },
  { value: 'week', label: 'Every week' },
  { value: 'month', label: 'Every month' },
] as const;

/** Like "Every week on Mon, Thu, Europe/Berlin time, until Jul 1, 10:00 UTC". */
export function describeRepeat(repeat: MaintenanceRepeat): string {
  let text = `Every ${repeat.every}`;
  if (repeat.every === 'week' && repeat.weekdays) {
    text += ` on ${repeat.weekdays.map((day) => WEEKDAY_NAMES[day]?.slice(0, 3)).join(', ')}`;
  }
  if (repeat.every === 'month' && repeat.dayOfMonth) text += ` on day ${repeat.dayOfMonth}`;
  if (repeat.timeZone && repeat.timeZone !== 'UTC') text += `, ${repeat.timeZone} time`;
  if (repeat.until !== undefined) {
    text += `, until ${formatUtcShort(new Date(repeat.until).getTime() / 1000)}`;
  }
  return text;
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

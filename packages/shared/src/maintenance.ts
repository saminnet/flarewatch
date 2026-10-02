import type { Maintenance, MaintenanceConfig, MaintenanceRepeat } from './types';
import { isJsonObject, isNonEmptyString } from './utils';

/** One run of a window, in ms. A window with no end runs on: its end is Infinity. */
export type Occurrence = { start: number; end: number };

type MaintenanceWindow = Pick<MaintenanceConfig, 'start' | 'end' | 'repeat'>;

const DAY = 24 * 60 * 60 * 1000;
/** Any rule matches a day within 62 days; a longer miss means a rule no day can match. */
const MAX_DAYS_WITHOUT_RUN = 366;

const toMs = (value: number | string) => new Date(value).getTime();

const formats = new Map<string, Intl.DateTimeFormat>();

/** Throws a RangeError for a zone the runtime does not know. */
function zoneFormat(timeZone: string): Intl.DateTimeFormat {
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formats.set(timeZone, format);
  }
  return format;
}

/** How far the zone's clock is ahead of UTC at the instant `at`, in ms. */
function offsetAt(at: number, timeZone: string): number {
  if (timeZone === 'UTC') return 0;
  const parts = zoneFormat(timeZone).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wall - Math.floor(at / 1000) * 1000;
}

/**
 * The instant the zone's clock reads `wall` (a wall-clock time written as UTC ms). When the clock
 * reads it twice, the first; when the clock skips it, the instant it skips forward.
 */
function wallToInstant(wall: number, timeZone: string): number {
  const before = offsetAt(wall - DAY, timeZone);
  const after = offsetAt(wall + DAY, timeZone);
  const fits = [wall - before, wall - after].filter((at) => at + offsetAt(at, timeZone) === wall);
  if (fits.length > 0) return Math.min(...fits);

  let lo = Math.floor((wall - after) / 1000);
  let hi = Math.ceil((wall - before) / 1000);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsetAt(mid * 1000, timeZone) === before) lo = mid;
    else hi = mid;
  }
  return hi * 1000;
}

/** Runs of a repeating window, oldest first, from the first one that ends at or after `from`. */
function* runs(window: MaintenanceWindow, repeat: MaintenanceRepeat, from: number) {
  // An unknown zone counts as UTC: one bad stored window must not stop every check run.
  const timeZone = knownZone(repeat.timeZone ?? 'UTC') ?? 'UTC';
  const start = toMs(window.start);
  const duration = toMs(window.end ?? window.start) - start;
  const until = repeat.until === undefined ? Infinity : toMs(repeat.until);

  const startWall = start + offsetAt(start, timeZone);
  const startDay = Math.floor(startWall / DAY);
  const timeOfDay = startWall - startDay * DAY;
  const startDate = new Date(startDay * DAY);
  const weekdays = repeat.weekdays ?? [startDate.getUTCDay()];
  const dayOfMonth = repeat.dayOfMonth ?? startDate.getUTCDate();
  const matches = (date: Date) =>
    repeat.every === 'day' ||
    (repeat.every === 'week' && weekdays.includes(date.getUTCDay())) ||
    (repeat.every === 'month' && date.getUTCDate() === dayOfMonth);

  const earliest = Math.max(from - duration, start);
  // A day early: a skipped hour can push a run past midnight into the next day.
  let day = Math.floor((earliest + offsetAt(earliest, timeZone)) / DAY) - 1;
  for (let missed = 0; missed < MAX_DAYS_WITHOUT_RUN; day++) {
    if (!matches(new Date(day * DAY))) {
      missed++;
      continue;
    }
    missed = 0;
    // The start keeps its own instant when its wall-clock time comes twice that day.
    const runStart = day === startDay ? start : wallToInstant(day * DAY + timeOfDay, timeZone);
    if (runStart > until) return;
    if (runStart >= earliest) yield { start: runStart, end: runStart + duration };
  }
}

function oneOff(window: MaintenanceWindow): Occurrence {
  return {
    start: toMs(window.start),
    end: window.end === undefined ? Infinity : toMs(window.end),
  };
}

/** The window's runs that overlap from..to, both ends included, oldest first. */
export function maintenanceOccurrences(
  window: MaintenanceWindow,
  from: number,
  to: number,
): Occurrence[] {
  if (!window.repeat) {
    const occurrence = oneOff(window);
    return occurrence.end >= from && occurrence.start <= to ? [occurrence] : [];
  }
  const list: Occurrence[] = [];
  for (const occurrence of runs(window, window.repeat, from)) {
    if (occurrence.start > to) break;
    list.push(occurrence);
  }
  return list;
}

/** The run going on at `at`, or else the next one. Undefined once the window is over. */
export function nextMaintenanceOccurrence(
  window: MaintenanceWindow,
  at: number,
): Occurrence | undefined {
  if (!window.repeat) {
    const occurrence = oneOff(window);
    return occurrence.end > at ? occurrence : undefined;
  }
  for (const occurrence of runs(window, window.repeat, at)) {
    if (occurrence.end > at) return occurrence;
  }
  return undefined;
}

/** A run lasts from its start up to, not including, its end. */
export function isMaintenanceActive(window: MaintenanceWindow, at: number): boolean {
  return maintenanceOccurrences(window, at, at).some(
    (occurrence) => occurrence.start <= at && at < occurrence.end,
  );
}

export type MaintenancePhase = 'active' | 'upcoming' | 'past';

export function occurrencePhase(occurrence: Occurrence, now: number): MaintenancePhase {
  if (occurrence.end <= now) return 'past';
  return occurrence.start <= now ? 'active' : 'upcoming';
}

export function maintenancePhase(window: MaintenanceWindow, now: number): MaintenancePhase {
  const next = nextMaintenanceOccurrence(window, now);
  return next ? occurrencePhase(next, now) : 'past';
}

/**
 * When the window's last run ends at the latest; undefined while it runs on. Retention counts
 * from here. A repeating window's last run starts by its `until`.
 */
export function maintenanceExpiresAt(window: MaintenanceWindow): number | undefined {
  if (window.end === undefined) return undefined;
  if (!window.repeat) return toMs(window.end);
  if (window.repeat.until === undefined) return undefined;
  return toMs(window.repeat.until) + toMs(window.end) - toMs(window.start);
}

/** A window that lists no monitors covers every monitor. */
export function coversMonitor(maintenance: Maintenance, monitorId: string): boolean {
  return !maintenance.monitors?.length || maintenance.monitors.includes(monitorId);
}

type Normalized = { value: MaintenanceConfig } | { error: string };

function parseTime(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

/** Trimmed; blank is left out. Null when the value is set but is not a string. */
function optionalText(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  return value.trim() || undefined;
}

/** The zone's canonical name, or undefined when the runtime does not know it. */
export function knownZone(timeZone: string): string | undefined {
  try {
    return zoneFormat(timeZone).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function isIntFrom(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

const isWeekday = (value: unknown): value is number => isIntFrom(value, 0, 6);

const isEvery = (value: unknown): value is MaintenanceRepeat['every'] =>
  value === 'day' || value === 'week' || value === 'month';

function normalizeRepeat(
  input: unknown,
  start: number,
  end: number | undefined,
): { repeat: MaintenanceRepeat } | { error: string } {
  if (!isJsonObject(input)) return { error: 'Repeat must be an object' };
  const { every } = input;
  if (!isEvery(every)) return { error: 'Repeat must be every day, week or month' };
  if (end === undefined) return { error: 'A repeating window needs an end' };
  if (end <= start || end - start > DAY) {
    return { error: 'A repeating window must end after its start and last at most 24 hours' };
  }

  let weekdays: number[] | undefined;
  if (input.weekdays !== undefined) {
    if (every !== 'week') return { error: 'Weekdays only go with a weekly repeat' };
    const list = input.weekdays;
    if (!Array.isArray(list) || list.length === 0 || !list.every(isWeekday)) {
      return { error: 'Weekdays must be a list of numbers from 0 (Sunday) to 6' };
    }
    weekdays = Array.from(new Set(list)).sort((a, b) => a - b);
  }

  const { dayOfMonth } = input;
  if (dayOfMonth !== undefined) {
    if (every !== 'month') return { error: 'A day of the month only goes with a monthly repeat' };
    if (!isIntFrom(dayOfMonth, 1, 31)) {
      return { error: 'The day of the month must be a whole number from 1 to 31' };
    }
  }

  const until = input.until === undefined ? undefined : parseTime(input.until);
  if (input.until !== undefined && until === undefined) return { error: 'Until must be a date' };
  if (until !== undefined && until < start) return { error: 'Until must not be before start' };

  const zone = optionalText(input.timeZone);
  const timeZone = zone ? knownZone(zone) : undefined;
  if (zone === null || (zone && !timeZone)) {
    return { error: 'The time zone must be an IANA zone, like Europe/Berlin' };
  }

  return {
    repeat: {
      every,
      ...(weekdays && { weekdays }),
      ...(dayOfMonth !== undefined && { dayOfMonth }),
      ...(until !== undefined && { until: new Date(until).toISOString() }),
      ...(timeZone !== undefined && { timeZone }),
    },
  };
}

/** Size limits a window must meet to be written. A stored window is read without them. */
function overCap({ body, title = '', color = '', monitors = [] }: MaintenanceConfig) {
  if (body.length > 2000) return 'Description must be at most 2000 characters';
  if (title.length > 200) return 'Title must be at most 200 characters';
  if (color.length > 64) return 'Color must be at most 64 characters';
  if (monitors.length > 100) return 'Monitors must list at most 100 monitor ids';
  if (monitors.some((id) => id.length > 100)) return 'A monitor id must be at most 100 characters';
  return undefined;
}

/**
 * Checks a window as an operator, a script or the hub sends it, and returns it trimmed, with
 * ISO times and deduplicated monitors. Every place that accepts a window calls this; reading a
 * stored one passes `capped: false`.
 */
export function normalizeMaintenance(input: unknown, { capped = true } = {}): Normalized {
  if (!isJsonObject(input)) return { error: 'A maintenance window must be an object' };

  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!body) return { error: 'Description must not be empty' };

  const start = parseTime(input.start);
  if (start === undefined) return { error: 'Start must be a date' };
  const end = input.end === undefined ? undefined : parseTime(input.end);
  if (input.end !== undefined && end === undefined) return { error: 'End must be a date' };
  if (end !== undefined && end < start) return { error: 'End must not be before start' };

  const title = optionalText(input.title);
  if (title === null) return { error: 'Title must be text' };
  const color = optionalText(input.color);
  if (color === null) return { error: 'Color must be text' };

  let monitors: string[] | undefined;
  if (input.monitors !== undefined) {
    // Dropping a bad entry could empty the list, which would widen the window to every monitor.
    if (!Array.isArray(input.monitors) || !input.monitors.every(isNonEmptyString)) {
      return { error: 'Monitors must be a list of monitor ids' };
    }
    monitors = input.monitors.length > 0 ? Array.from(new Set(input.monitors)) : undefined;
  }

  let repeat: MaintenanceRepeat | undefined;
  if (input.repeat !== undefined) {
    const result = normalizeRepeat(input.repeat, start, end);
    if ('error' in result) return result;
    repeat = result.repeat;
  }

  const value = {
    ...(title !== undefined && { title }),
    body,
    start: new Date(start).toISOString(),
    ...(end !== undefined && { end: new Date(end).toISOString() }),
    ...(monitors && { monitors }),
    ...(color !== undefined && { color }),
    ...(repeat && { repeat }),
  };
  const error = capped ? overCap(value) : undefined;
  return error ? { error } : { value };
}

const WINDOW_FIELDS = ['title', 'body', 'start', 'end', 'monitors', 'color', 'repeat'] as const;
const TIME_FIELDS = new Set(['start', 'end', 'until']);

function sameValue(raw: unknown, normal: unknown, field = ''): boolean {
  if (TIME_FIELDS.has(field)) return parseTime(raw) === parseTime(normal);
  // An empty monitor list, which normalizing leaves out, covers every monitor all the same.
  if (Array.isArray(raw) && raw.length === 0 && normal === undefined) return true;
  if (Array.isArray(raw) && Array.isArray(normal)) {
    const list: unknown[] = normal;
    return raw.length === list.length && raw.every((item: unknown, i) => sameValue(item, list[i]));
  }
  if (isJsonObject(raw) && isJsonObject(normal)) {
    const keys = new Set([...Object.keys(raw), ...Object.keys(normal)]);
    return [...keys].every((key) => sameValue(raw[key], normal[key], key));
  }
  return raw === normal;
}

/**
 * Whether the window is already as normalizeMaintenance returns it. Times may be written another
 * way for the same instant; keys outside the window's own fields are ignored.
 */
export function isNormalizedMaintenance(value: unknown): boolean {
  const result = normalizeMaintenance(value, { capped: false });
  return (
    isJsonObject(value) &&
    'value' in result &&
    WINDOW_FIELDS.every((field) => sameValue(value[field], result.value[field], field))
  );
}

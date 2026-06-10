import { format } from 'date-fns';

/**
 * Parse a "yyyy-MM" string into year and month numbers.
 */
export function parseYearMonth(value: string): { year: number; month: number } {
  const [yearStr = '1970', monthStr = '01'] = value.split('-');
  return {
    year: Number(yearStr),
    month: Number(monthStr),
  };
}

/**
 * Validate that a value is a valid "yyyy-MM" string.
 */
export function isValidYearMonth(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/**
 * Shift a "yyyy-MM" string by a number of months.
 */
export function shiftYearMonth(value: string, deltaMonths: number): string {
  const { year, month } = parseYearMonth(value);
  const shifted = new Date(Date.UTC(year, month - 1 + deltaMonths, 1));
  return shifted.toISOString().slice(0, 7);
}

/**
 * Get UTC month boundaries for a "yyyy-MM" string.
 */
export function getUtcMonthBounds(value: string): { monthStart: Date; monthEnd: Date } {
  const { year, month } = parseYearMonth(value);
  const monthIndex = month - 1;
  const monthStart = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));
  return { monthStart, monthEnd };
}

function toUtcViewDate(date: Date): Date {
  return new Date(date.getTime() + date.getTimezoneOffset() * 60_000);
}

export function formatUtc(date: Date, pattern: string): string {
  return format(toUtcViewDate(date), pattern);
}

/**
 * Get an ISO date key (yyyy-MM-dd) for a UTC midnight Date, suitable for Map lookups.
 */
export function getDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Format a date/time using a fixed, locale-independent format.
 * This avoids SSR hydration mismatches caused by different server/client locales.
 */
export function formatDateTime(date: Date): string {
  return format(date, 'MMM d, yyyy h:mm a');
}

export interface CalendarDay {
  date: Date;
  isToday: boolean;
  isFuture: boolean;
}

export interface CalendarMonthGrid {
  yearMonth: string;
  label: string;
  weeks: (CalendarDay | null)[][];
}

/**
 * Generate calendar grids for the given number of months.
 * When `endYearMonth` is provided (e.g. "2026-02"), the window ends at that month.
 * Otherwise it ends at the month of `nowUtc`.
 * Each grid uses ISO week layout (Mon–Sun columns), with `null` padding for cells outside the month.
 */
export function generateCalendarGrids(
  nowUtc: Date,
  monthCount: number,
  endYearMonth?: string,
): CalendarMonthGrid[] {
  const todayYear = nowUtc.getUTCFullYear();
  const todayMonth = nowUtc.getUTCMonth();
  const todayDate = nowUtc.getUTCDate();
  const todayMidnight = Date.UTC(todayYear, todayMonth, todayDate);

  // Determine the "end" month for the window
  let endYear = todayYear;
  let endMonth = todayMonth;
  if (endYearMonth) {
    const parsed = parseYearMonth(endYearMonth);
    endYear = parsed.year;
    endMonth = parsed.month - 1; // 0-indexed
  }

  const grids: CalendarMonthGrid[] = [];

  for (let i = monthCount - 1; i >= 0; i--) {
    const firstOfMonth = new Date(Date.UTC(endYear, endMonth - i, 1));
    const year = firstOfMonth.getUTCFullYear();
    const month = firstOfMonth.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    // Mon=0, Tue=1, ..., Sun=6
    const firstDayOfWeek = (firstOfMonth.getUTCDay() + 6) % 7;

    const weeks: (CalendarDay | null)[][] = [];
    let currentWeek: (CalendarDay | null)[] = [];

    for (let p = 0; p < firstDayOfWeek; p++) {
      currentWeek.push(null);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(Date.UTC(year, month, d));
      const dateMs = date.getTime();

      currentWeek.push({
        date,
        isToday: dateMs === todayMidnight,
        isFuture: dateMs > todayMidnight,
      });

      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
    }

    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      weeks.push(currentWeek);
    }

    const yearMonth = firstOfMonth.toISOString().slice(0, 7);
    const label = formatUtc(firstOfMonth, 'MMMM yyyy');

    grids.push({ yearMonth, label, weeks });
  }

  return grids;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 * @param ms - Duration in milliseconds
 * @param options.minUnit - Minimum unit to show: 'seconds' (default) or 'minutes'
 */
export function formatDuration(ms: number, options?: { minUnit?: 'seconds' | 'minutes' }): string {
  if (ms <= 0) return '0m';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (options?.minUnit === 'minutes') return `${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

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

export function toUtcViewDate(date: Date): Date {
  return new Date(date.getTime() + date.getTimezoneOffset() * 60_000);
}

export function formatUtc(date: Date, pattern: string): string {
  return format(toUtcViewDate(date), pattern);
}

/**
 * Format a date/time using a fixed, locale-independent format.
 * This avoids SSR hydration mismatches caused by different server/client locales.
 */
export function formatDateTime(date: Date): string {
  return format(date, 'MMM d, yyyy h:mm a');
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

import { format } from 'date-fns';

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

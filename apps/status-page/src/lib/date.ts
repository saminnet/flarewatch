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

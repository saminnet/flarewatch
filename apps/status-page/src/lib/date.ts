import { format } from 'date-fns';

export function toUtcViewDate(date: Date): Date {
  return new Date(date.getTime() + date.getTimezoneOffset() * 60_000);
}

export function formatUtc(date: Date, pattern: string): string {
  return format(toUtcViewDate(date), pattern);
}

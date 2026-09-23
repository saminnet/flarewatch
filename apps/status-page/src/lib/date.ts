import { format } from 'date-fns';

export function parseYearMonth(value: string) {
  const [yearStr = '1970', monthStr = '01'] = value.split('-');
  return {
    year: Number(yearStr),
    month: Number(monthStr),
  };
}

export function isValidYearMonth(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

export function shiftYearMonth(value: string, deltaMonths: number): string {
  const { year, month } = parseYearMonth(value);
  const shifted = new Date(Date.UTC(year, month - 1 + deltaMonths, 1));
  return shifted.toISOString().slice(0, 7);
}

export function getUtcMonthBounds(value: string) {
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

export function getDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
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
 * Calendar window ends at `endYearMonth` (or the month of `nowUtc`); weeks are Mon–Sun, `null`-padded.
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

/** Human duration like "2d 3h"; `minUnit: 'minutes'` stops the breakdown at minutes (default 'seconds'). */
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

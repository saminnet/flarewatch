import { describe, it, expect } from 'vite-plus/test';
import {
  parseYearMonth,
  isValidYearMonth,
  shiftYearMonth,
  getUtcMonthBounds,
  generateCalendarGrids,
  formatUtc,
  formatDuration,
  formatCadence,
} from '@/lib/date';

describe('parseYearMonth', () => {
  it('parses valid year-month strings', () => {
    expect(parseYearMonth('2024-01')).toEqual({ year: 2024, month: 1 });
    expect(parseYearMonth('2023-12')).toEqual({ year: 2023, month: 12 });
    expect(parseYearMonth('1999-06')).toEqual({ year: 1999, month: 6 });
  });
});

describe('isValidYearMonth', () => {
  it('accepts valid year-month strings', () => {
    expect(isValidYearMonth('2024-01')).toBe(true);
    expect(isValidYearMonth('2024-12')).toBe(true);
    expect(isValidYearMonth('1999-06')).toBe(true);
  });

  it('rejects invalid formats', () => {
    expect(isValidYearMonth('2024-1')).toBe(false);
    expect(isValidYearMonth('24-01')).toBe(false);
    expect(isValidYearMonth('2024/01')).toBe(false);
    expect(isValidYearMonth('invalid')).toBe(false);
    expect(isValidYearMonth(null)).toBe(false);
    expect(isValidYearMonth(undefined)).toBe(false);
  });

  it('rejects invalid month values', () => {
    expect(isValidYearMonth('2024-00')).toBe(false);
    expect(isValidYearMonth('2024-13')).toBe(false);
  });
});

describe('shiftYearMonth', () => {
  it('shifts months forward', () => {
    expect(shiftYearMonth('2024-01', 1)).toBe('2024-02');
    expect(shiftYearMonth('2024-06', 3)).toBe('2024-09');
  });

  it('shifts months backward', () => {
    expect(shiftYearMonth('2024-03', -1)).toBe('2024-02');
    expect(shiftYearMonth('2024-06', -3)).toBe('2024-03');
  });

  it('handles year boundaries', () => {
    expect(shiftYearMonth('2024-12', 1)).toBe('2025-01');
    expect(shiftYearMonth('2024-01', -1)).toBe('2023-12');
    expect(shiftYearMonth('2024-06', 12)).toBe('2025-06');
  });
});

describe('getUtcMonthBounds', () => {
  it('returns correct month boundaries', () => {
    const { monthStart, monthEnd } = getUtcMonthBounds('2024-01');
    expect(monthStart.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(monthEnd.toISOString()).toBe('2024-01-31T23:59:59.999Z');
  });

  it('handles February in leap year', () => {
    const { monthEnd } = getUtcMonthBounds('2024-02');
    expect(monthEnd.getUTCDate()).toBe(29);
  });

  it('handles February in non-leap year', () => {
    const { monthEnd } = getUtcMonthBounds('2023-02');
    expect(monthEnd.getUTCDate()).toBe(28);
  });
});

describe('generateCalendarGrids', () => {
  it('rolls months back across a year boundary', () => {
    const grids = generateCalendarGrids(new Date('2025-03-15T12:00:00Z'), 3, '2025-01');

    expect(grids.map((grid) => grid.yearMonth)).toEqual(['2024-11', '2024-12', '2025-01']);
    expect(grids.map((grid) => grid.weeks.flat().filter(Boolean).length)).toEqual([30, 31, 31]);
    expect(
      grids.map((grid) => grid.weeks.flat().find(Boolean)?.date.toISOString().slice(0, 10)),
    ).toEqual(['2024-11-01', '2024-12-01', '2025-01-01']);
  });
});

describe('formatUtc', () => {
  it('formats a UTC date independent of the local timezone offset', () => {
    expect(formatUtc(new Date('2026-06-09T12:30:00.000Z'), 'MMM d, HH:mm')).toBe('Jun 9, 12:30');
  });
});

describe('formatCadence', () => {
  it('picks the shortest unit that divides the period evenly', () => {
    expect(formatCadence(900)).toBe('15m');
    expect(formatCadence(1800)).toBe('30m');
    expect(formatCadence(3600)).toBe('1h');
    expect(formatCadence(86400)).toBe('24h');
    expect(formatCadence(604800)).toBe('7d');
  });

  it('renders zero as 0s instead of 0h', () => {
    expect(formatCadence(0)).toBe('0s');
  });

  it('falls back to seconds for odd values', () => {
    expect(formatCadence(90)).toBe('90s');
  });

  it('prefers the larger unit when both divide', () => {
    expect(formatCadence(172800)).toBe('2d');
  });
});

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(45000)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(125000)).toBe('2m 5s');
  });

  it('keeps a zero secondary unit unpadded', () => {
    expect(formatDuration(240000)).toBe('4m 0s');
    expect(formatDuration(7200000)).toBe('2h 0m');
    expect(formatDuration(3660000)).toBe('1h 1m');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(4320000)).toBe('1h 12m');
  });

  it('formats days and hours', () => {
    expect(formatDuration(90000000)).toBe('1d 1h');
    expect(formatDuration(86400000)).toBe('1d 0h');
  });

  it('handles zero and negative values', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(-1000)).toBe('0m');
  });

  it('respects minUnit option', () => {
    expect(formatDuration(30000, { minUnit: 'minutes' })).toBe('0m');
    expect(formatDuration(90000, { minUnit: 'minutes' })).toBe('1m');
  });
});

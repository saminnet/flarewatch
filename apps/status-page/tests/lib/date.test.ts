import { describe, it, expect } from 'vitest';
import {
  parseYearMonth,
  isValidYearMonth,
  shiftYearMonth,
  getUtcMonthBounds,
  formatDuration,
} from '../../src/lib/date';

describe('parseYearMonth', () => {
  it('parses valid year-month strings', () => {
    expect(parseYearMonth('2024-01')).toEqual({ year: 2024, month: 1 });
    expect(parseYearMonth('2023-12')).toEqual({ year: 2023, month: 12 });
    expect(parseYearMonth('1999-06')).toEqual({ year: 1999, month: 6 });
  });

  it('returns defaults for invalid input', () => {
    // Empty string splits to [''] - yearStr='', monthStr=undefined (uses default '01')
    expect(parseYearMonth('')).toEqual({ year: 0, month: 1 });
    // 'invalid' splits to ['invalid'] - yearStr='invalid' (NaN), monthStr=undefined (uses default '01')
    expect(parseYearMonth('invalid')).toEqual({ year: NaN, month: 1 });
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

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(45000)).toBe('45s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(125000)).toBe('2m 5s');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3660000)).toBe('1h 1m');
    expect(formatDuration(7200000)).toBe('2h 0m');
  });

  it('formats days and hours', () => {
    expect(formatDuration(90000000)).toBe('1d 1h');
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

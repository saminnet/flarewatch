import { describe, expect, it } from 'vite-plus/test';
import {
  isMaintenanceActive,
  maintenanceExpiresAt,
  maintenanceOccurrences,
  maintenancePhase,
  nextMaintenanceOccurrence,
  normalizeMaintenance,
  occurrencePhase,
} from '../src/maintenance';

const at = (iso: string) => Date.parse(iso);

describe('a one-off window', () => {
  const window = { start: '2026-06-10T10:00:00Z', end: '2026-06-10T12:00:00Z' };
  const open = { start: '2026-06-10T10:00:00Z' };

  it('is active from its start up to, not including, its end', () => {
    expect(isMaintenanceActive(window, at('2026-06-10T09:59:59.999Z'))).toBe(false);
    expect(isMaintenanceActive(window, at('2026-06-10T10:00:00Z'))).toBe(true);
    expect(isMaintenanceActive(window, at('2026-06-10T11:59:59.999Z'))).toBe(true);
    expect(isMaintenanceActive(window, at('2026-06-10T12:00:00Z'))).toBe(false);
    expect(isMaintenanceActive(open, at('2030-01-01T00:00:00Z'))).toBe(true);
  });

  it('has one occurrence in a range that touches it at either edge', () => {
    const only = [{ start: at('2026-06-10T10:00:00Z'), end: at('2026-06-10T12:00:00Z') }];
    expect(
      maintenanceOccurrences(window, at('2026-06-10T12:00:00Z'), at('2026-06-11T00:00:00Z')),
    ).toEqual(only);
    expect(
      maintenanceOccurrences(window, at('2026-06-09T00:00:00Z'), at('2026-06-10T10:00:00Z')),
    ).toEqual(only);
    expect(
      maintenanceOccurrences(window, at('2026-06-10T12:00:00.001Z'), at('2026-06-12T00:00:00Z')),
    ).toEqual([]);
    expect(
      maintenanceOccurrences(window, at('2026-06-01T00:00:00Z'), at('2026-06-10T09:59:59Z')),
    ).toEqual([]);
    expect(
      maintenanceOccurrences(open, at('2030-01-01T00:00:00Z'), at('2030-02-01T00:00:00Z')),
    ).toEqual([{ start: at('2026-06-10T10:00:00Z'), end: Infinity }]);
  });

  it('is upcoming before its start, active during it and past from its end', () => {
    expect(maintenancePhase(window, at('2026-06-10T09:00:00Z'))).toBe('upcoming');
    expect(maintenancePhase(window, at('2026-06-10T11:00:00Z'))).toBe('active');
    expect(maintenancePhase(window, at('2026-06-10T12:00:00Z'))).toBe('past');
    expect(maintenancePhase(open, at('2030-01-01T00:00:00Z'))).toBe('active');
    expect(nextMaintenanceOccurrence(window, at('2026-06-10T12:00:00Z'))).toBeUndefined();
    expect(occurrencePhase({ start: 10, end: 20 }, 20)).toBe('past');
  });

  it('expires at its end and never without one', () => {
    expect(maintenanceExpiresAt(window)).toBe(at('2026-06-10T12:00:00Z'));
    expect(maintenanceExpiresAt(open)).toBeUndefined();
  });
});

describe('normalizeMaintenance', () => {
  const valid = { body: 'Database upgrade', start: '2026-06-10T10:00:00Z' };

  it('trims text, drops blank fields, writes ISO times and dedupes monitors', () => {
    expect(
      normalizeMaintenance({
        ...valid,
        body: '  Database upgrade ',
        title: '   ',
        color: ' red ',
        start: at('2026-06-10T10:00:00Z'),
        end: '2026-06-10T12:00:00+02:00',
        monitors: ['api', 'web', 'api'],
      }),
    ).toEqual({
      value: {
        body: 'Database upgrade',
        color: 'red',
        start: '2026-06-10T10:00:00.000Z',
        end: '2026-06-10T10:00:00.000Z',
        monitors: ['api', 'web'],
      },
    });
  });

  it('reads an empty monitor list as every monitor', () => {
    expect(normalizeMaintenance({ ...valid, monitors: [] })).toEqual({
      value: { body: 'Database upgrade', start: '2026-06-10T10:00:00.000Z' },
    });
  });

  it.each([
    ['no body', { start: valid.start }],
    ['a blank body', { ...valid, body: '  ' }],
    ['an unparseable start', { ...valid, start: 'soon' }],
    ['an unparseable end', { ...valid, end: '2026-13-45' }],
    ['an end before the start', { ...valid, end: '2026-06-10T09:59:59Z' }],
    ['a title that is not text', { ...valid, title: 5 }],
    ['a color that is not text', { ...valid, color: false }],
    ['monitors that are not a list', { ...valid, monitors: 'api' }],
    ['a blank monitor id', { ...valid, monitors: ['api', ''] }],
    ['an array', [valid]],
  ])('rejects %s', (_name, input) => {
    expect(normalizeMaintenance(input)).toHaveProperty('error');
  });

  const ids = (count: number) => Array.from({ length: count }, (_, index) => `m${index}`);

  it.each([
    ['body', 'Description must be at most 2000 characters', 'b'.repeat(2000), 'b'.repeat(2001)],
    ['title', 'Title must be at most 200 characters', 't'.repeat(200), 't'.repeat(201)],
    ['color', 'Color must be at most 64 characters', 'c'.repeat(64), 'c'.repeat(65)],
    ['monitors', 'Monitors must list at most 100 monitor ids', ids(100), ids(101)],
    [
      'monitors',
      'A monitor id must be at most 100 characters',
      ['i'.repeat(100)],
      ['i'.repeat(101)],
    ],
  ])('caps %s: %s', (field, error, atCap, overCap) => {
    expect(normalizeMaintenance({ ...valid, [field]: atCap })).toHaveProperty('value');
    expect(normalizeMaintenance({ ...valid, [field]: overCap })).toEqual({ error });
  });
});

/** Runs as [start, end] ISO pairs, easier to read in a failure than ms. */
function runs(window: Parameters<typeof maintenanceOccurrences>[0], from: string, to: string) {
  return maintenanceOccurrences(window, at(from), at(to)).map(({ start, end }) => [
    new Date(start).toISOString(),
    new Date(end).toISOString(),
  ]);
}

describe('a repeating window', () => {
  it('keeps 09:00 Berlin time across the spring-forward change', () => {
    const window = {
      start: '2026-03-27T08:00:00Z',
      end: '2026-03-27T08:30:00Z',
      repeat: { every: 'day' as const, timeZone: 'Europe/Berlin' },
    };
    expect(runs(window, '2026-03-28T00:00:00Z', '2026-03-31T00:00:00Z')).toEqual([
      ['2026-03-28T08:00:00.000Z', '2026-03-28T08:30:00.000Z'],
      ['2026-03-29T07:00:00.000Z', '2026-03-29T07:30:00.000Z'],
      ['2026-03-30T07:00:00.000Z', '2026-03-30T07:30:00.000Z'],
    ]);
  });

  it('keeps 09:00 Berlin time across the fall-back change', () => {
    const window = {
      start: '2026-10-20T07:00:00Z',
      end: '2026-10-20T08:00:00Z',
      repeat: { every: 'day' as const, timeZone: 'Europe/Berlin' },
    };
    expect(runs(window, '2026-10-24T00:00:00Z', '2026-10-26T23:00:00Z')).toEqual([
      ['2026-10-24T07:00:00.000Z', '2026-10-24T08:00:00.000Z'],
      ['2026-10-25T08:00:00.000Z', '2026-10-25T09:00:00.000Z'],
      ['2026-10-26T08:00:00.000Z', '2026-10-26T09:00:00.000Z'],
    ]);
  });

  it('starts a run in the skipped hour when the clocks go forward', () => {
    const window = {
      start: '2026-03-28T01:30:00Z',
      end: '2026-03-28T02:30:00Z',
      repeat: { every: 'day' as const, timeZone: 'Europe/Berlin' },
    };
    expect(runs(window, '2026-03-28T00:00:00Z', '2026-03-30T12:00:00Z').map(([s]) => s)).toEqual([
      '2026-03-28T01:30:00.000Z',
      '2026-03-29T01:00:00.000Z',
      '2026-03-30T00:30:00.000Z',
    ]);
  });

  it('takes the first of a repeated hour when the clocks go back', () => {
    const window = {
      start: '2026-10-24T00:30:00Z',
      end: '2026-10-24T01:00:00Z',
      repeat: { every: 'day' as const, timeZone: 'Europe/Berlin' },
    };
    expect(runs(window, '2026-10-24T00:00:00Z', '2026-10-26T12:00:00Z').map(([s]) => s)).toEqual([
      '2026-10-24T00:30:00.000Z',
      '2026-10-25T00:30:00.000Z',
      '2026-10-26T01:30:00.000Z',
    ]);
  });

  it('keeps a start in the second of a repeated hour as the first run', () => {
    const window = {
      start: '2026-10-25T01:30:00Z',
      end: '2026-10-25T02:00:00Z',
      repeat: { every: 'day' as const, timeZone: 'Europe/Berlin' },
    };
    expect(runs(window, '2026-10-25T00:00:00Z', '2026-10-26T12:00:00Z').map(([s]) => s)).toEqual([
      '2026-10-25T01:30:00.000Z',
      '2026-10-26T01:30:00.000Z',
    ]);
  });

  it('finds a run that a skipped day pushed past midnight', () => {
    // Samoa skipped 30 December 2011: its clocks went from the 29th, 23:59:59, to the 31st.
    const window = {
      start: '2011-12-28T20:00:00Z',
      end: '2011-12-28T21:00:00Z',
      repeat: { every: 'day' as const, timeZone: 'Pacific/Apia' },
    };
    expect(runs(window, '2011-12-30T11:00:00Z', '2011-12-30T23:00:00Z')).toEqual([
      ['2011-12-30T10:00:00.000Z', '2011-12-30T11:00:00.000Z'],
      ['2011-12-30T20:00:00.000Z', '2011-12-30T21:00:00.000Z'],
    ]);
  });

  it('repeats monthly on the 31st and skips months without one', () => {
    const window = {
      start: '2026-01-31T22:00:00Z',
      end: '2026-01-31T23:00:00Z',
      repeat: { every: 'month' as const },
    };
    expect(runs(window, '2026-01-01T00:00:00Z', '2026-08-15T00:00:00Z').map(([s]) => s)).toEqual([
      '2026-01-31T22:00:00.000Z',
      '2026-03-31T22:00:00.000Z',
      '2026-05-31T22:00:00.000Z',
      '2026-07-31T22:00:00.000Z',
    ]);
  });

  it('repeats monthly on a set day', () => {
    const window = {
      start: '2026-01-31T22:00:00Z',
      end: '2026-01-31T23:00:00Z',
      repeat: { every: 'month' as const, dayOfMonth: 1 },
    };
    expect(runs(window, '2026-01-01T00:00:00Z', '2026-03-15T00:00:00Z').map(([s]) => s)).toEqual([
      '2026-02-01T22:00:00.000Z',
      '2026-03-01T22:00:00.000Z',
    ]);
  });

  it('repeats weekly on several weekdays', () => {
    const window = {
      start: '2026-06-01T20:00:00Z',
      end: '2026-06-01T21:00:00Z',
      repeat: { every: 'week' as const, weekdays: [1, 3, 5] },
    };
    expect(runs(window, '2026-06-01T00:00:00Z', '2026-06-08T23:59:59Z').map(([s]) => s)).toEqual([
      '2026-06-01T20:00:00.000Z',
      '2026-06-03T20:00:00.000Z',
      '2026-06-05T20:00:00.000Z',
      '2026-06-08T20:00:00.000Z',
    ]);
  });

  it("repeats weekly on the start's weekday by default and from the start on", () => {
    const window = {
      start: '2026-06-02T20:00:00Z',
      end: '2026-06-02T21:00:00Z',
      repeat: { every: 'week' as const },
    };
    expect(runs(window, '2026-05-01T00:00:00Z', '2026-06-17T00:00:00Z').map(([s]) => s)).toEqual([
      '2026-06-02T20:00:00.000Z',
      '2026-06-09T20:00:00.000Z',
      '2026-06-16T20:00:00.000Z',
    ]);
  });

  it('starts no run after until', () => {
    const daily = (until: string) => ({
      start: '2026-06-01T10:00:00Z',
      end: '2026-06-01T11:00:00Z',
      repeat: { every: 'day' as const, until },
    });
    const range = ['2026-06-01T00:00:00Z', '2026-06-30T00:00:00Z'] as const;
    expect(runs(daily('2026-06-03T10:00:00Z'), ...range).map(([s]) => s)).toEqual([
      '2026-06-01T10:00:00.000Z',
      '2026-06-02T10:00:00.000Z',
      '2026-06-03T10:00:00.000Z',
    ]);
    expect(runs(daily('2026-06-03T09:59:59Z'), ...range)).toHaveLength(2);
    expect(
      nextMaintenanceOccurrence(daily('2026-06-03T10:00:00Z'), at('2026-06-03T11:00:00Z')),
    ).toBeUndefined();
    expect(maintenancePhase(daily('2026-06-03T10:00:00Z'), at('2026-06-03T11:00:00Z'))).toBe(
      'past',
    );
  });

  it('has no run in a range between two runs', () => {
    const window = {
      start: '2026-06-01T20:00:00Z',
      end: '2026-06-01T21:00:00Z',
      repeat: { every: 'week' as const },
    };
    expect(runs(window, '2026-06-02T00:00:00Z', '2026-06-07T23:59:59Z')).toEqual([]);
    expect(runs(window, '2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z')).toEqual([]);
  });

  it('is active only during a run, including one that started the day before', () => {
    const window = {
      start: '2026-06-01T23:00:00Z',
      end: '2026-06-02T01:00:00Z',
      repeat: { every: 'day' as const },
    };
    expect(isMaintenanceActive(window, at('2026-06-01T22:59:59Z'))).toBe(false);
    expect(isMaintenanceActive(window, at('2026-06-05T00:30:00Z'))).toBe(true);
    expect(isMaintenanceActive(window, at('2026-06-05T01:00:00Z'))).toBe(false);
    expect(isMaintenanceActive(window, at('2026-06-05T12:00:00Z'))).toBe(false);
    expect(maintenancePhase(window, at('2026-06-05T12:00:00Z'))).toBe('upcoming');
    expect(nextMaintenanceOccurrence(window, at('2026-06-05T00:30:00Z'))).toEqual({
      start: at('2026-06-04T23:00:00Z'),
      end: at('2026-06-05T01:00:00Z'),
    });
    expect(nextMaintenanceOccurrence(window, at('2026-06-05T12:00:00Z'))).toEqual({
      start: at('2026-06-05T23:00:00Z'),
      end: at('2026-06-06T01:00:00Z'),
    });
  });

  it('falls back to UTC for a zone the runtime does not know', () => {
    const window = {
      start: '2026-06-01T10:00:00Z',
      end: '2026-06-01T11:00:00Z',
      repeat: { every: 'day' as const, timeZone: 'Mars/Olympus' },
    };
    expect(runs(window, '2026-06-02T00:00:00Z', '2026-06-02T23:59:59Z')).toEqual([
      ['2026-06-02T10:00:00.000Z', '2026-06-02T11:00:00.000Z'],
    ]);
    expect(
      isMaintenanceActive(
        { ...window, repeat: { ...window.repeat, timeZone: ' UTC ' } },
        at('2026-06-03T10:30:00Z'),
      ),
    ).toBe(true);
  });

  it('expires when its last run ends, and never without until', () => {
    const window = { start: '2026-06-01T10:00:00Z', end: '2026-06-01T11:30:00Z' };
    expect(
      maintenanceExpiresAt({ ...window, repeat: { every: 'day', until: '2026-07-01T10:00:00Z' } }),
    ).toBe(at('2026-07-01T11:30:00Z'));
    expect(maintenanceExpiresAt({ ...window, repeat: { every: 'day' } })).toBeUndefined();
  });
});

describe('normalizeMaintenance with a repeat', () => {
  const valid = {
    body: 'Backups',
    start: '2026-06-01T10:00:00Z',
    end: '2026-06-01T11:00:00Z',
  };

  it('keeps the rule with sorted weekdays, an ISO until and the canonical zone', () => {
    expect(
      normalizeMaintenance({
        ...valid,
        repeat: {
          every: 'week',
          weekdays: [5, 1, 5],
          until: at('2026-09-01T00:00:00Z'),
          timeZone: ' europe/berlin ',
        },
      }),
    ).toEqual({
      value: {
        ...valid,
        start: '2026-06-01T10:00:00.000Z',
        end: '2026-06-01T11:00:00.000Z',
        repeat: {
          every: 'week',
          weekdays: [1, 5],
          until: '2026-09-01T00:00:00.000Z',
          timeZone: 'Europe/Berlin',
        },
      },
    });
  });

  it('accepts a run of exactly 24 hours', () => {
    expect(
      normalizeMaintenance({ ...valid, end: '2026-06-02T10:00:00Z', repeat: { every: 'day' } }),
    ).toHaveProperty('value');
  });

  it.each([
    ['a rule that is not an object', 'daily'],
    ['an unknown frequency', { every: 'year' }],
    ['weekdays on a daily rule', { every: 'day', weekdays: [1] }],
    ['an empty weekday list', { every: 'week', weekdays: [] }],
    ['a weekday past Saturday', { every: 'week', weekdays: [7] }],
    ['a fractional weekday', { every: 'week', weekdays: [1.5] }],
    ['a day of the month on a weekly rule', { every: 'week', dayOfMonth: 3 }],
    ['day 0 of the month', { every: 'month', dayOfMonth: 0 }],
    ['day 32 of the month', { every: 'month', dayOfMonth: 32 }],
    ['an unparseable until', { every: 'day', until: 'later' }],
    ['an until before the start', { every: 'day', until: '2026-06-01T09:59:59Z' }],
    ['an unknown time zone', { every: 'day', timeZone: 'Mars/Olympus' }],
    ['a time zone that is not text', { every: 'day', timeZone: 1 }],
  ])('rejects %s', (_name, repeat) => {
    expect(normalizeMaintenance({ ...valid, repeat })).toHaveProperty('error');
  });

  it.each([
    ['no end', { body: 'Backups', start: valid.start }],
    ['an end at the start', { ...valid, end: valid.start }],
    ['a run over 24 hours', { ...valid, end: '2026-06-02T10:00:01Z' }],
  ])('rejects a repeating window with %s', (_name, window) => {
    expect(normalizeMaintenance({ ...window, repeat: { every: 'day' } })).toHaveProperty('error');
  });
});

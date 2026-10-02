import { describe, expect, it } from 'vite-plus/test';
import type { Maintenance } from '@flarewatch/shared';
import {
  compareByStart,
  describeRepeat,
  filterMaintenances,
  formatDateRange,
  formatTimeUntil,
  getMaintenanceColors,
  getMaintenanceStatus,
  getSeverityOption,
  resolveAffectedMonitors,
} from '@/lib/maintenance';

function maintenance(id: string, start: string, end?: string): Maintenance {
  return {
    id,
    start,
    end,
    body: id,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('maintenance helpers', () => {
  const now = Date.parse('2026-06-09T12:00:00Z');

  it('classifies active, past, upcoming, and scheduled maintenance', () => {
    expect(
      getMaintenanceStatus(
        maintenance('active', '2026-06-09T11:00:00.000Z', '2026-06-09T13:00:00.000Z'),
        now,
      ),
    ).toBe('active');
    expect(
      getMaintenanceStatus(
        maintenance('past', '2026-06-08T11:00:00.000Z', '2026-06-08T12:00:00.000Z'),
        now,
      ),
    ).toBe('past');
    expect(getMaintenanceStatus(maintenance('upcoming', '2026-06-10T12:00:00.000Z'), now)).toBe(
      'upcoming',
    );
    expect(getMaintenanceStatus(maintenance('scheduled', '2026-07-10T12:00:00.000Z'), now)).toBe(
      'scheduled',
    );
  });

  it('filters and sorts visible maintenance buckets', () => {
    const activeB = maintenance('active-b', '2026-06-09T10:00:00.000Z', '2026-06-09T14:00:00.000Z');
    const activeA = maintenance('active-a', '2026-06-09T09:00:00.000Z', '2026-06-09T13:00:00.000Z');
    const upcoming = maintenance('upcoming', '2026-06-10T12:00:00.000Z');
    const pastOld = maintenance('past-old', '2026-06-06T12:00:00.000Z', '2026-06-06T13:00:00.000Z');
    const pastNew = maintenance('past-new', '2026-06-08T12:00:00.000Z', '2026-06-08T13:00:00.000Z');
    const scheduled = maintenance('scheduled', '2026-07-10T12:00:00.000Z');

    const result = filterMaintenances([activeB, pastOld, scheduled, upcoming, activeA, pastNew], {
      nowMs: now,
      upcomingDays: 7,
    });

    expect(result.active.map((m) => m.id)).toEqual(['active-a', 'active-b']);
    expect(result.upcoming.map((m) => m.id)).toEqual(['upcoming']);
    expect(result.past.map((m) => m.id)).toEqual(['past-new', 'past-old']);
  });

  it('orders by start time across numeric and string starts', () => {
    const numeric = { ...maintenance('a', ''), start: Date.parse('2026-06-10T09:00:00Z') };
    const iso = maintenance('b', '2026-06-09T10:00:00.000Z');
    const offset = maintenance('c', '2026-06-09T11:00:00+02:00');

    expect([numeric, iso, offset].sort(compareByStart).map((m) => m.id)).toEqual(['c', 'b', 'a']);
  });

  it('formats time ranges and relative durations', () => {
    expect(
      formatDateRange(new Date('2026-06-09T12:30:00.000Z'), new Date('2026-06-09T13:45:00.000Z')),
    ).toBe('Jun 9, 12:30–13:45 UTC');
    expect(
      formatDateRange(new Date('2026-06-09T23:30:00.000Z'), new Date('2026-06-10T01:00:00.000Z')),
    ).toBe('Jun 9, 23:30 – Jun 10, 01:00 UTC');
    expect(formatDateRange(new Date('2026-06-09T12:30:00.000Z'), null)).toBe('Jun 9, 12:30 UTC');
    expect(formatTimeUntil(new Date('2026-06-09T13:30:00.000Z'), new Date(now))).toBe('1h 30m');
  });

  it('resolves display metadata with defaults', () => {
    expect(getMaintenanceColors('green').dot).toBe('bg-status-unknown');
    expect(getSeverityOption('red').label).toBe('Critical');
    expect(getSeverityOption('missing').value).toBe('yellow');
  });

  it('falls back to status-maintenance tokens when no severity color is authored', () => {
    // No color and unknown colors use the runtime maintenance tokens, not the severity palette.
    for (const colors of [getMaintenanceColors(), getMaintenanceColors('missing')]) {
      expect(colors).toEqual({
        bg: 'bg-status-maintenance-bg',
        border: 'border-status-maintenance-border',
        icon: 'text-status-maintenance',
        dot: 'bg-status-maintenance',
      });
    }
  });

  it('resolves affected monitors in configured order and skips unknown ids', () => {
    const monitors = [
      { id: 'api', name: 'API' },
      { id: 'web', name: 'Web' },
    ];

    expect(resolveAffectedMonitors(['web', 'missing', 'api'], monitors).map((m) => m.id)).toEqual([
      'web',
      'api',
    ]);
    expect(resolveAffectedMonitors(undefined, monitors)).toEqual([]);
  });

  it('sorts repeating windows by their current or next run', () => {
    const daily = {
      ...maintenance('daily', '2026-05-01T10:00:00.000Z', '2026-05-01T11:00:00.000Z'),
      repeat: { every: 'day' as const },
    };
    const tuesdays = {
      ...maintenance('tuesdays', '2026-05-05T11:00:00.000Z', '2026-05-05T13:00:00.000Z'),
      repeat: { every: 'week' as const },
    };
    const ended = {
      ...maintenance('ended', '2026-05-01T10:00:00.000Z', '2026-05-01T11:00:00.000Z'),
      repeat: { every: 'day' as const, until: '2026-06-01T10:00:00.000Z' },
    };
    const oneOff = maintenance('one-off', '2026-06-10T09:00:00.000Z', '2026-06-10T09:30:00.000Z');

    const result = filterMaintenances([daily, tuesdays, ended, oneOff], { nowMs: now });

    expect(result.active.map((m) => m.id)).toEqual(['tuesdays']);
    expect(result.upcoming.map((m) => m.id)).toEqual(['one-off', 'daily']);
    expect(result.past.map((m) => m.id)).toEqual(['ended']);
    expect(getMaintenanceStatus(daily, now)).toBe('upcoming');
  });

  it('describes a repeat rule', () => {
    expect(describeRepeat({ every: 'day' })).toBe('Every day');
    expect(describeRepeat({ every: 'month', dayOfMonth: 31 })).toBe('Every month on day 31');
    expect(
      describeRepeat({
        every: 'week',
        weekdays: [1, 4],
        timeZone: 'Europe/Berlin',
        until: '2026-07-01T10:00:00.000Z',
      }),
    ).toBe('Every week on Mon, Thu, Europe/Berlin time, until Jul 1, 10:00 UTC');
  });
});

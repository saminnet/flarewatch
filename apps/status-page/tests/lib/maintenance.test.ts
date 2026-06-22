import { describe, expect, it } from 'vite-plus/test';
import type { Maintenance } from '@flarewatch/shared';
import {
  compareByStart,
  filterMaintenances,
  formatDateRange,
  formatTimeUntil,
  getMaintenanceColors,
  getMaintenanceStatus,
  getSeverityOption,
  resolveAffectedMonitors,
} from '../../src/lib/maintenance';

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

  it('compares ISO start strings lexicographically', () => {
    expect(
      compareByStart(
        maintenance('a', '2026-06-09T09:00:00.000Z'),
        maintenance('b', '2026-06-09T10:00:00.000Z'),
      ),
    ).toBe(-1);
  });

  it('formats time ranges and relative durations', () => {
    expect(
      formatDateRange(new Date('2026-06-09T12:30:00.000Z'), new Date('2026-06-09T13:45:00.000Z')),
    ).toBe('Jun 9, 12:30 - Jun 9, 13:45');
    expect(formatTimeUntil(new Date('2026-06-09T13:30:00.000Z'), new Date(now))).toBe('1h 30m');
  });

  it('resolves display metadata with defaults', () => {
    expect(getMaintenanceColors('green').dot).toBe('bg-emerald-500');
    expect(getSeverityOption('red').labelKey).toBe('severity.critical');
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
});

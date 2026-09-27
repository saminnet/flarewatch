import { describe, it, expect, beforeEach, afterEach, vi } from 'vite-plus/test';
import type { MonitorView, StatusView } from '@flarewatch/shared';
import {
  calculateUptimePercent,
  countStatuses,
  generateAggregateDailyStatus,
  generateDailyStatus,
  isMonitorUp,
  getMonitorError,
  getLatestLatency,
  getOverallStatus,
} from '@/lib/uptime';

function view(
  monitors: Record<string, Partial<MonitorView>>,
  lastUpdate = Math.floor(Date.now() / 1000),
): StatusView {
  return {
    lastUpdate,
    monitors: Object.fromEntries(
      Object.entries(monitors).map(([id, monitor]) => [
        id,
        { status: 'up', incidents: [], ...monitor },
      ]),
    ),
  };
}

describe('uptime utilities', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('calculateUptimePercent', () => {
    it('returns 100% when there are no incidents', () => {
      const state = view({ test: { startedAt: Math.floor(Date.now() / 1000) - 86400 } });

      const result = calculateUptimePercent('test', state);

      expect(result).toBe(100);
    });

    it('calculates correct percentage for incident fully inside window', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const state = view({
        test: {
          startedAt: nowSec - 86400,
          incidents: [{ start: [nowSec - 3600], end: nowSec - 1800, error: ['Error'] }],
        },
      });

      const result = calculateUptimePercent('test', state);

      expect(result).toBeCloseTo(97.9167, 3);
    });

    it('treats open incident end as now', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const state = view({
        test: {
          status: 'down',
          startedAt: nowSec - 86400,
          incidents: [{ start: [nowSec - 3600], end: undefined, error: ['Ongoing error'] }],
        },
      });

      const result = calculateUptimePercent('test', state);

      expect(result).toBeCloseTo(95.8333, 3);
    });

    it('uses startedAt as window start for recently started monitors', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const state = view({
        test: {
          startedAt: nowSec - 3600,
          incidents: [{ start: [nowSec - 1800], end: nowSec - 900, error: ['Error'] }],
        },
      });

      const result = calculateUptimePercent('test', state);

      expect(result).toBe(75);
    });

    it('clips incident downtime at the window start', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const state = view({
        test: {
          startedAt: nowSec - 200 * 24 * 60 * 60,
          incidents: [
            {
              start: [nowSec - 100 * 24 * 60 * 60],
              end: nowSec - 50 * 24 * 60 * 60,
              error: ['Error'],
            },
          ],
        },
      });

      const result = calculateUptimePercent('test', state);

      expect(result).toBeCloseTo(55.5556, 3);
    });
  });

  describe('generateDailyStatus', () => {
    it('marks days before monitor start unknown', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const state = view({ test: { startedAt: nowSec - 3600 } });

      const result = generateDailyStatus('test', state);

      expect(result).toHaveLength(90);
      expect(result.filter((day) => day.status === 'unknown')).toHaveLength(89);
      expect(result[89]?.status).toBe('up');
    });

    it('returns correct status based on downtime thresholds', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const state = view({ test: { startedAt: nowSec - 90 * 24 * 60 * 60 } });

      const result = generateDailyStatus('test', state);

      const todayStatus = result[result.length - 1];
      expect(todayStatus?.status).toBe('up');
    });

    it('marks day as partial when uptime is between 50-99.9%', () => {
      const now = new Date('2025-01-15T12:00:00Z');
      const nowSec = Math.floor(now.getTime() / 1000);
      const todayStart = new Date('2025-01-15T00:00:00Z').getTime() / 1000;

      const state = view({
        test: {
          startedAt: nowSec - 90 * 24 * 60 * 60,
          incidents: [{ start: [todayStart], end: todayStart + 3600, error: ['Error'] }],
        },
      });

      const result = generateDailyStatus('test', state);

      const todayStatus = result[result.length - 1];
      expect(todayStatus?.status).toBe('partial');
    });
  });

  describe('generateAggregateDailyStatus', () => {
    const now = new Date('2025-01-15T12:00:00Z');
    const nowSec = Math.floor(now.getTime() / 1000);
    const dayStart = new Date('2025-01-05T00:00:00Z').getTime() / 1000;

    it('prefers down over partial and skips unknown monitors', () => {
      const state = view(
        {
          down: {
            startedAt: nowSec - 90 * 24 * 60 * 60,
            incidents: [{ start: [dayStart], end: dayStart + 0.6 * 86_400, error: ['Down'] }],
          },
          partial: {
            startedAt: nowSec - 90 * 24 * 60 * 60,
            incidents: [{ start: [dayStart], end: dayStart + 0.2 * 86_400, error: ['Degraded'] }],
          },
        },
        nowSec,
      );

      const days = generateAggregateDailyStatus(
        ['down', 'partial', 'unknown'],
        new Map([
          ['down', 'Down monitor'],
          ['partial', 'Partial monitor'],
          ['unknown', 'Unknown monitor'],
        ]),
        state,
      );

      const downDay = days.find((day) => day.date.getTime() / 1000 === dayStart);
      expect(downDay?.status).toBe('down');
      expect(downDay?.uptime).toBe(60);

      const normalDay = days[days.length - 1];
      expect(normalDay?.status).toBe('up');
      expect(normalDay?.uptime).toBe(100);
    });
  });

  describe('isMonitorUp', () => {
    it('returns true when there are no incidents', () => {
      expect(isMonitorUp('test', view({ test: { status: 'up' } }))).toBe(true);
    });

    it('returns true when last incident is closed', () => {
      const state = view({
        test: { status: 'up', incidents: [{ start: [1000], end: 2000, error: ['Error'] }] },
      });

      expect(isMonitorUp('test', state)).toBe(true);
    });

    it('returns false when the monitor is down with an open incident', () => {
      const state = view({
        test: {
          status: 'down',
          incidents: [{ start: [1000], end: undefined, error: ['Error'] }],
        },
      });

      expect(isMonitorUp('test', state)).toBe(false);
    });

    it('treats late, pending and running jobs as up', () => {
      const state = view({
        late: { status: 'late' },
        pending: { status: 'pending' },
        running: { status: 'running' },
      });

      expect(isMonitorUp('late', state)).toBe(true);
      expect(isMonitorUp('pending', state)).toBe(true);
      expect(isMonitorUp('running', state)).toBe(true);
    });
  });

  describe('getMonitorError', () => {
    it('returns null when there are no incidents', () => {
      expect(getMonitorError('test', view({ test: {} }))).toBeNull();
    });

    it('returns null when last incident is closed', () => {
      const state = view({
        test: { incidents: [{ start: [1000], end: 2000, error: ['Error'] }] },
      });

      expect(getMonitorError('test', state)).toBeNull();
    });

    it('returns error message when incident is open', () => {
      const state = view({
        test: {
          status: 'down',
          incidents: [
            { start: [1000, 2000], end: undefined, error: ['First error', 'Second error'] },
          ],
        },
      });

      expect(getMonitorError('test', state)).toBe('Second error');
    });
  });

  describe('getLatestLatency', () => {
    it('returns null when there is no latency data', () => {
      expect(getLatestLatency('test', view({ test: {} }))).toBeNull();
    });

    it('returns the latest latency sample when present', () => {
      const state = view({ test: { latest: { loc: 'EU', ping: 120, time: 2 } } });

      expect(getLatestLatency('test', state)).toEqual({ loc: 'EU', ping: 120, time: 2 });
    });
  });

  describe('countStatuses', () => {
    it('counts pending and running as up and keeps late apart from up and down', () => {
      const state = view({
        up: { status: 'up' },
        pending: { status: 'pending' },
        running: { status: 'running' },
        late: { status: 'late' },
        down: { status: 'down', incidents: [{ start: [1000], error: ['Error'] }] },
        down2: { status: 'down', incidents: [{ start: [1000], error: ['Error'] }] },
      });

      expect(countStatuses(state)).toEqual({ up: 3, late: 1, down: 2 });
    });
  });

  describe('getOverallStatus', () => {
    it('returns operational when all monitors are up', () => {
      expect(getOverallStatus({ up: 3, late: 0, down: 0 })).toBe('operational');
    });

    it('returns degraded when a heartbeat monitor is late and none are down', () => {
      expect(getOverallStatus({ up: 3, late: 1, down: 0 })).toBe('degraded');
    });

    it('returns degraded when some monitors are down', () => {
      expect(getOverallStatus({ up: 2, late: 0, down: 1 })).toBe('degraded');
    });

    it('returns degraded when the only monitors not down are late', () => {
      expect(getOverallStatus({ up: 0, late: 1, down: 2 })).toBe('degraded');
    });

    it('returns down when all monitors are down', () => {
      expect(getOverallStatus({ up: 0, late: 0, down: 3 })).toBe('down');
    });
  });
});

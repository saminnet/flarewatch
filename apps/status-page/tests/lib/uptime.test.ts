import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MonitorState } from '@flarewatch/shared';
import {
  calculateUptimePercent,
  generateDailyStatus,
  isMonitorUp,
  getMonitorError,
  getLatestLatency,
  getOverallStatus,
} from '../../src/lib/uptime';

const createEmptyState = (lastUpdate?: number): MonitorState => ({
  lastUpdate: lastUpdate ?? Math.floor(Date.now() / 1000),
  overallUp: 0,
  overallDown: 0,
  startedAt: {},
  incident: {},
  latency: {},
});

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
      const state = createEmptyState();
      state.incident['test'] = [];
      state.startedAt['test'] = Math.floor(Date.now() / 1000) - 86400;

      const result = calculateUptimePercent('test', state);

      expect(result).toBe(100);
    });

    it('calculates correct percentage for incident fully inside window', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const state = createEmptyState();
      state.startedAt['test'] = nowSec - 86400;
      state.incident['test'] = [
        {
          start: [nowSec - 3600],
          end: nowSec - 1800,
          error: ['Error'],
        },
      ];

      const result = calculateUptimePercent('test', state);

      expect(result).toBeGreaterThan(97);
      expect(result).toBeLessThan(100);
    });

    it('treats open incident end as now', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const state = createEmptyState();
      state.startedAt['test'] = nowSec - 86400;
      state.incident['test'] = [
        {
          start: [nowSec - 3600],
          end: undefined,
          error: ['Ongoing error'],
        },
      ];

      const result = calculateUptimePercent('test', state);

      expect(result).toBeGreaterThan(95);
      expect(result).toBeLessThan(100);
    });

    it('uses startedAt as window start for recently started monitors', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const monitorStartSec = nowSec - 3600;
      const state = createEmptyState();
      state.startedAt['test'] = monitorStartSec;
      state.incident['test'] = [
        {
          start: [nowSec - 1800],
          end: nowSec - 900,
          error: ['Error'],
        },
      ];

      const result = calculateUptimePercent('test', state);

      expect(result).toBe(75);
    });
  });

  describe('generateDailyStatus', () => {
    it('returns unknown status for days before monitor start', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const state = createEmptyState();
      state.startedAt['test'] = nowSec - 3600;
      state.incident['test'] = [];

      const result = generateDailyStatus('test', state);

      const oldDays = result.filter((d) => d.status === 'unknown');
      expect(oldDays.length).toBeGreaterThan(85);
    });

    it('returns correct status based on downtime thresholds', () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const state = createEmptyState();
      state.startedAt['test'] = nowSec - 90 * 24 * 60 * 60;
      state.incident['test'] = [];

      const result = generateDailyStatus('test', state);

      const todayStatus = result[result.length - 1];
      expect(todayStatus?.status).toBe('up');
    });

    it('marks day as partial when uptime is between 50-99.9%', () => {
      const now = new Date('2025-01-15T12:00:00Z');
      const nowSec = Math.floor(now.getTime() / 1000);
      const todayStart = new Date('2025-01-15T00:00:00Z').getTime() / 1000;

      const state = createEmptyState();
      state.startedAt['test'] = nowSec - 90 * 24 * 60 * 60;
      state.incident['test'] = [
        {
          start: [todayStart],
          end: todayStart + 3600,
          error: ['Error'],
        },
      ];

      const result = generateDailyStatus('test', state);

      const todayStatus = result[result.length - 1];
      expect(todayStatus?.status).toBe('partial');
    });
  });

  describe('isMonitorUp', () => {
    it('returns true when there are no incidents', () => {
      const state = createEmptyState();
      state.incident['test'] = [];

      expect(isMonitorUp('test', state)).toBe(true);
    });

    it('returns true when last incident is closed', () => {
      const state = createEmptyState();
      state.incident['test'] = [{ start: [1000], end: 2000, error: ['Error'] }];

      expect(isMonitorUp('test', state)).toBe(true);
    });

    it('returns false when last incident is open', () => {
      const state = createEmptyState();
      state.incident['test'] = [{ start: [1000], end: undefined, error: ['Error'] }];

      expect(isMonitorUp('test', state)).toBe(false);
    });
  });

  describe('getMonitorError', () => {
    it('returns null when there are no incidents', () => {
      const state = createEmptyState();
      state.incident['test'] = [];

      expect(getMonitorError('test', state)).toBeNull();
    });

    it('returns null when last incident is closed', () => {
      const state = createEmptyState();
      state.incident['test'] = [{ start: [1000], end: 2000, error: ['Error'] }];

      expect(getMonitorError('test', state)).toBeNull();
    });

    it('returns error message when incident is open', () => {
      const state = createEmptyState();
      state.incident['test'] = [
        { start: [1000, 2000], end: undefined, error: ['First error', 'Second error'] },
      ];

      expect(getMonitorError('test', state)).toBe('Second error');
    });
  });

  describe('getLatestLatency', () => {
    it('returns null when there is no latency data', () => {
      const state = createEmptyState();
      state.latency['test'] = { recent: [] };

      expect(getLatestLatency('test', state)).toBeNull();
    });

    it('returns the last latency record when present', () => {
      const state = createEmptyState();
      state.latency['test'] = {
        recent: [
          { loc: 'US', ping: 100, time: 1 },
          { loc: 'EU', ping: 120, time: 2 },
        ],
      };

      expect(getLatestLatency('test', state)).toEqual({ loc: 'EU', ping: 120, time: 2 });
    });
  });

  describe('getOverallStatus', () => {
    it('returns operational when all monitors are up', () => {
      const state = createEmptyState();
      state.overallUp = 3;
      state.overallDown = 0;

      expect(getOverallStatus(state)).toBe('operational');
    });

    it('returns degraded when some monitors are down', () => {
      const state = createEmptyState();
      state.overallUp = 2;
      state.overallDown = 1;

      expect(getOverallStatus(state)).toBe('degraded');
    });

    it('returns down when all monitors are down', () => {
      const state = createEmptyState();
      state.overallUp = 0;
      state.overallDown = 3;

      expect(getOverallStatus(state)).toBe('down');
    });
  });
});

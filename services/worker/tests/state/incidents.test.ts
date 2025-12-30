import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MonitorTarget } from '@flarewatch/shared';
import {
  processCheckResult,
  updateLatency,
  updateSSLCertificate,
  cleanupOldIncidents,
  createInitialState,
  resetCounters,
} from '../../src/state/incidents';

const createMonitor = (id = 'test-monitor'): MonitorTarget => ({
  id,
  name: 'Test Monitor',
  method: 'GET',
  target: 'https://example.com',
});

describe('incidents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('processCheckResult', () => {
    it('creates startedAt and increments overallUp when ok=true with no history', () => {
      const state = createInitialState();
      const monitor = createMonitor();
      const currentTime = 1000;

      const result = processCheckResult(state, monitor, { ok: true, latency: 100 }, currentTime);

      expect(state.startedAt[monitor.id]).toBe(currentTime);
      expect(state.overallUp).toBe(1);
      expect(state.overallDown).toBe(0);
      expect(result.statusChanged).toBe(false);
      expect(result.isUp).toBe(true);
    });

    it('creates new incident with undefined end when ok=false with no history', () => {
      const state = createInitialState();
      const monitor = createMonitor();
      const currentTime = 1000;

      const result = processCheckResult(
        state,
        monitor,
        { ok: false, error: 'Connection refused' },
        currentTime,
      );

      expect(state.overallDown).toBe(1);
      expect(state.incident[monitor.id]).toHaveLength(1);
      expect(state.incident[monitor.id]![0]!.start).toEqual([currentTime]);
      expect(state.incident[monitor.id]![0]!.end).toBeUndefined();
      expect(state.incident[monitor.id]![0]!.error).toEqual(['Connection refused']);
      expect(result.statusChanged).toBe(true);
      expect(result.changeType).toBe('down');
      expect(result.isUp).toBe(false);
    });

    it('does not append new segment when down with same error', () => {
      const state = createInitialState();
      const monitor = createMonitor();
      state.incident[monitor.id] = [
        { start: [1000], end: undefined, error: ['Connection refused'] },
      ];

      const result = processCheckResult(
        state,
        monitor,
        { ok: false, error: 'Connection refused' },
        2000,
      );

      expect(state.incident[monitor.id]).toHaveLength(1);
      expect(state.incident[monitor.id]![0]!.start).toEqual([1000]);
      expect(state.incident[monitor.id]![0]!.error).toEqual(['Connection refused']);
      expect(result.statusChanged).toBe(false);
      expect(result.changeType).toBe('none');
    });

    it('appends error segment when down with different error', () => {
      const state = createInitialState();
      const monitor = createMonitor();
      state.incident[monitor.id] = [
        { start: [1000], end: undefined, error: ['Connection refused'] },
      ];

      const result = processCheckResult(state, monitor, { ok: false, error: 'Timeout' }, 2000);

      expect(state.incident[monitor.id]).toHaveLength(1);
      expect(state.incident[monitor.id]![0]!.start).toEqual([1000, 2000]);
      expect(state.incident[monitor.id]![0]!.error).toEqual(['Connection refused', 'Timeout']);
      expect(result.statusChanged).toBe(true);
      expect(result.changeType).toBe('error');
    });

    it('closes incident when transitioning from down to up', () => {
      const state = createInitialState();
      const monitor = createMonitor();
      state.incident[monitor.id] = [
        { start: [1000], end: undefined, error: ['Connection refused'] },
      ];

      const result = processCheckResult(state, monitor, { ok: true, latency: 100 }, 2000);

      expect(state.incident[monitor.id]![0]!.end).toBe(2000);
      expect(result.statusChanged).toBe(true);
      expect(result.changeType).toBe('up');
      expect(result.isUp).toBe(true);
    });

    it('does not change incidents when up stays up', () => {
      const state = createInitialState();
      const monitor = createMonitor();
      state.incident[monitor.id] = [{ start: [1000], end: 1500, error: ['Connection refused'] }];

      const result = processCheckResult(state, monitor, { ok: true, latency: 100 }, 2000);

      expect(state.incident[monitor.id]).toHaveLength(1);
      expect(state.incident[monitor.id]![0]!.end).toBe(1500);
      expect(result.statusChanged).toBe(false);
      expect(result.changeType).toBe('none');
    });

    it('preserves incidentStartTime as first incident start', () => {
      const state = createInitialState();
      const monitor = createMonitor();
      state.incident[monitor.id] = [
        { start: [1000, 1500], end: undefined, error: ['Error 1', 'Error 2'] },
      ];

      const result = processCheckResult(state, monitor, { ok: false, error: 'Error 3' }, 2000);

      expect(result.incidentStartTime).toBe(1000);
    });
  });

  describe('updateLatency', () => {
    it('appends new latency record', () => {
      const state = createInitialState();
      const monitorId = 'test-monitor';
      state.latency[monitorId] = { recent: [] };

      updateLatency(state, monitorId, 'US', 150, 1000);

      expect(state.latency[monitorId]!.recent).toHaveLength(1);
      expect(state.latency[monitorId]!.recent[0]).toEqual({
        loc: 'US',
        ping: 150,
        time: 1000,
      });
    });

    it('prunes records older than 12 hours', () => {
      const state = createInitialState();
      const monitorId = 'test-monitor';
      const twelveHoursInSec = 12 * 60 * 60;
      const currentTime = 100000;

      state.latency[monitorId] = {
        recent: [
          { loc: 'US', ping: 100, time: currentTime - twelveHoursInSec - 100 },
          { loc: 'US', ping: 110, time: currentTime - twelveHoursInSec - 50 },
          { loc: 'US', ping: 120, time: currentTime - twelveHoursInSec + 100 },
        ],
      };

      updateLatency(state, monitorId, 'EU', 150, currentTime);

      expect(state.latency[monitorId]!.recent).toHaveLength(2);
      expect(state.latency[monitorId]!.recent[0]!.time).toBe(currentTime - twelveHoursInSec + 100);
      expect(state.latency[monitorId]!.recent[1]!.loc).toBe('EU');
    });
  });

  describe('updateSSLCertificate', () => {
    it('creates sslCertificates map and stores lastCheck', () => {
      const state = createInitialState();
      const monitorId = 'test-monitor';
      const currentTime = 1000;

      updateSSLCertificate(
        state,
        monitorId,
        { expiryDate: 1735689600, daysUntilExpiry: 30, issuer: 'Example CA', subject: 'example' },
        currentTime,
      );

      expect(state.sslCertificates).toBeDefined();
      expect(state.sslCertificates?.[monitorId]).toEqual({
        expiryDate: 1735689600,
        daysUntilExpiry: 30,
        issuer: 'Example CA',
        subject: 'example',
        lastCheck: currentTime,
      });
    });
  });

  describe('cleanupOldIncidents', () => {
    it('removes old closed incidents but keeps open incidents', () => {
      const state = createInitialState();
      const monitorId = 'test-monitor';
      const retentionSeconds = 90 * 24 * 60 * 60;
      const currentTime = 1_000_000;
      const cutoff = currentTime - retentionSeconds;

      state.incident[monitorId] = [
        { start: [cutoff - 200], end: cutoff - 100, error: ['very old'] },
        { start: [cutoff - 10], end: cutoff, error: ['boundary'] },
        { start: [currentTime - 60], end: undefined, error: ['open'] },
      ];

      cleanupOldIncidents(state, monitorId, currentTime);

      expect(state.incident[monitorId]).toHaveLength(2);
      expect(state.incident[monitorId]?.[0]?.error).toEqual(['boundary']);
      expect(state.incident[monitorId]?.[1]?.end).toBeUndefined();
    });
  });

  describe('createInitialState', () => {
    it('returns empty state structure', () => {
      const state = createInitialState();

      expect(state).toEqual({
        lastUpdate: 0,
        overallUp: 0,
        overallDown: 0,
        startedAt: {},
        incident: {},
        latency: {},
      });
    });
  });

  describe('resetCounters', () => {
    it('resets overallUp and overallDown to zero', () => {
      const state = createInitialState();
      state.overallUp = 5;
      state.overallDown = 2;

      resetCounters(state);

      expect(state.overallUp).toBe(0);
      expect(state.overallDown).toBe(0);
    });
  });
});

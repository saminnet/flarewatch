import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MonitorTarget } from '@flarewatch/shared';
import {
  formatNotificationMessage,
  type NotificationContext,
} from '../../src/notifications/webhook';

const createMonitor = (name = 'Test Monitor'): MonitorTarget => ({
  id: 'test-monitor',
  name,
  method: 'GET',
  target: 'https://example.com',
});

const createContext = (overrides: Partial<NotificationContext> = {}): NotificationContext => ({
  monitor: createMonitor(),
  isUp: false,
  incidentStartTime: 1000,
  currentTime: 2000,
  reason: 'Connection refused',
  timeZone: 'UTC',
  ...overrides,
});

describe('webhook notifications', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatNotificationMessage', () => {
    it('formats initial outage message when currentTime equals incidentStartTime', () => {
      const ctx = createContext({
        isUp: false,
        incidentStartTime: 1000,
        currentTime: 1000,
        reason: 'Connection refused',
      });

      const message = formatNotificationMessage(ctx);

      expect(message).toContain('Test Monitor is down');
      expect(message).toContain('Reason: Connection refused');
      expect(message).not.toContain('still down');
    });

    it('formats ongoing outage message when currentTime differs from incidentStartTime', () => {
      const ctx = createContext({
        isUp: false,
        incidentStartTime: 1000,
        currentTime: 2000,
        reason: 'Connection refused',
      });

      const message = formatNotificationMessage(ctx);

      expect(message).toContain('Test Monitor is still down');
      expect(message).toContain('Reason: Connection refused');
    });

    it('formats recovery message when isUp is true', () => {
      const ctx = createContext({
        isUp: true,
        incidentStartTime: 1000,
        currentTime: 2000,
      });

      const message = formatNotificationMessage(ctx);

      expect(message).toContain('Test Monitor is up');
      expect(message).toContain('recovered');
    });

    it('uses "Unknown" as fallback when reason is empty', () => {
      const ctx = createContext({
        isUp: false,
        incidentStartTime: 1000,
        currentTime: 1000,
        reason: '',
      });

      const message = formatNotificationMessage(ctx);

      expect(message).toContain('Reason: Unknown');
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vite-plus/test';
import type { MonitorTarget, Webhook } from '@flarewatch/shared';
import {
  buildTemplateContext,
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
  kind: 'down',
  incidentStartTime: 1000,
  currentTime: 2000,
  downtimeSeconds: 1000,
  reason: 'Connection refused',
  timeZone: 'UTC',
  alsoDown: [],
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
    it('formats a down alert sent the run its outage began as an initial outage', () => {
      const ctx = createContext({
        incidentStartTime: 1000,
        currentTime: 1000,
        downtimeSeconds: 0,
        reason: 'Connection refused',
      });

      const message = formatNotificationMessage(ctx);

      expect(message).toContain('Test Monitor is down');
      expect(message).toContain('Reason: Connection refused');
      expect(message).not.toContain('still down');
    });

    it('formats a later down alert as an ongoing outage', () => {
      const ctx = createContext({
        incidentStartTime: 1000,
        currentTime: 2000,
        reason: 'Connection refused',
      });

      const message = formatNotificationMessage(ctx);

      expect(message).toContain('Test Monitor is still down');
      expect(message).toContain('Reason: Connection refused');
    });

    it('formats a recovery', () => {
      const ctx = createContext({
        kind: 'recovered',
        incidentStartTime: 1000,
        currentTime: 2000,
      });

      const message = formatNotificationMessage(ctx);

      expect(message).toContain('Test Monitor is up');
      expect(message).toContain('recovered');
    });

    it('ends a down message with the monitors down behind it', () => {
      const message = formatNotificationMessage(createContext({ alsoDown: ['App', 'Dashboard'] }));

      expect(message).toMatch(/\nAlso down: App, Dashboard$/);
    });

    it('uses "Unknown" as fallback when reason is empty', () => {
      const ctx = createContext({
        incidentStartTime: 1000,
        currentTime: 1000,
        downtimeSeconds: 0,
        reason: '',
      });

      const message = formatNotificationMessage(ctx);

      expect(message).toContain('Reason: Unknown');
    });
  });

  describe('buildTemplateContext', () => {
    const webhook: Webhook = { url: 'https://hooks.example.com/webhook' };

    it('reuses one incidentKey across down and up', () => {
      const down = buildTemplateContext(
        createContext({
          incidentStartTime: 1700000000,
          currentTime: 1700000000,
          downtimeSeconds: 0,
        }),
        webhook,
      );
      const up = buildTemplateContext(
        createContext({
          kind: 'recovered',
          incidentStartTime: 1700000000,
          currentTime: 1700000300,
          downtimeSeconds: 300,
        }),
        webhook,
      );

      expect(down.incidentKey).toBe('test-monitor:1700000000');
      expect(up.incidentKey).toBe(down.incidentKey);
    });

    it('drops the credentials from a target URL and keeps a host:port target', () => {
      const targetUrl = (target: string) =>
        buildTemplateContext(createContext({ monitor: { ...createMonitor(), target } }), webhook)
          .targetUrl;

      expect(targetUrl('https://alice:s3cret@example.com/health')).toBe(
        'https://example.com/health',
      );
      expect(targetUrl('db.example.com:5432')).toBe('db.example.com:5432');
      expect(targetUrl('https://example.com')).toBe('https://example.com');
    });

    it('passes webhook url and options into the template context', () => {
      const ctx = buildTemplateContext(createContext(), {
        url: 'https://hooks.example.com/webhook',
        options: { token: 't0k3n' },
      });

      expect(ctx.webhookUrl).toBe('https://hooks.example.com/webhook');
      expect(ctx.options).toEqual({ token: 't0k3n' });
    });
  });
});

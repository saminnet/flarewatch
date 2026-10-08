import { describe, it, expect, beforeEach, afterEach, vi } from 'vite-plus/test';
import type { Fetcher, MonitorTarget, Webhook } from '@flarewatch/shared';
import {
  buildTemplateContext,
  formatNotificationMessage,
  WebhookNotifier,
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

    it('sends down and recovery transaction URLs with the same incident key', async () => {
      const fetcher = vi.fn<Fetcher>(async () => new Response('ok'));
      const notifier = new WebhookNotifier({ ...webhook, template: 'matrix' }, fetcher);
      await expect(
        notifier.send(
          createContext({
            incidentStartTime: 1700000000,
            currentTime: 1700000000,
            downtimeSeconds: 0,
          }),
          '',
        ),
      ).resolves.toEqual([{ success: true, statusCode: 200 }]);
      await expect(
        notifier.send(
          createContext({
            kind: 'recovered',
            incidentStartTime: 1700000000,
            currentTime: 1700000300,
            downtimeSeconds: 300,
          }),
          '',
        ),
      ).resolves.toEqual([{ success: true, statusCode: 200 }]);

      expect(fetcher.mock.calls.map(([url]) => decodeURIComponent(new URL(url).pathname))).toEqual([
        '/webhook/test-monitor:1700000000-down-2023-11-14T22:13:20.000Z',
        '/webhook/test-monitor:1700000000-up-2023-11-14T22:18:20.000Z',
      ]);
      expect(fetcher.mock.calls.map(([, options]) => options?.method)).toEqual(['PUT', 'PUT']);
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

    it('sends to the configured recipient with option-derived payload fields', async () => {
      const requests: Request[] = [];
      const notifier = new WebhookNotifier(
        {
          url: 'https://hooks.example.com/webhook',
          template: 'pushover',
          options: { token: 't0k3n', user: 'recipient-key' },
        },
        async (url, options) => {
          requests.push(new Request(url, { ...options, body: options?.body ?? null }));
          return new Response('ok');
        },
      );

      await expect(notifier.send(createContext(), '')).resolves.toEqual([
        { success: true, statusCode: 200 },
      ]);
      expect(requests).toHaveLength(1);
      const request = requests[0]!;
      expect(request.url).toBe('https://hooks.example.com/webhook');
      expect(request.method).toBe('POST');
      expect(request.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
      const fields = new URLSearchParams(await request.text());
      expect(fields.get('token')).toBe('t0k3n');
      expect(fields.get('user')).toBe('recipient-key');
    });
  });
});

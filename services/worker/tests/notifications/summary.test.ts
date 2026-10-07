import { expect, it } from 'vite-plus/test';
import { NOTIFICATION_TEMPLATES } from '@flarewatch/shared';
import { WebhookNotifier, type NotificationContext } from '../../src/notifications/webhook';

const context = (
  kind: NotificationContext['kind'],
  name: string,
  downtimeSeconds = 0,
): NotificationContext => ({
  monitor: { id: name, name, method: 'GET', target: 'https://example.com' },
  kind,
  currentTime: 1800000000,
  incidentStartTime: 1800000000 - downtimeSeconds,
  downtimeSeconds,
  timeZone: 'UTC',
  reason: 'Expires tomorrow',
  alsoDown: [],
  ...(kind === 'reminder' && { reminder: 2 }),
});

it.each(NOTIFICATION_TEMPLATES)(
  'sends the five summary groups through %s without a monitor-specific target',
  async (template) => {
    const requests: { url: string; text: string }[] = [];
    const webhook = { url: 'https://hooks.example/summary', template };
    const notifier = new WebhookNotifier(webhook, async (url, options) => {
      requests.push({
        url,
        text: decodeURIComponent(
          (typeof options?.body === 'string' ? options.body : '').replaceAll('+', ' '),
        ),
      });
      return new Response('ok');
    });
    const contexts = [
      context('expiry', 'Certificate'),
      context('reminder', 'Reminder', 60),
      context('error', 'Changed', 60),
      context('recovered', 'Recovered', 60),
      context('down', 'Down'),
    ];
    expect((await notifier.sendSummary(webhook, contexts, 1000)).success).toBe(true);
    const text = requests[0]?.text ?? '';
    for (const name of ['Certificate', 'Reminder', 'Changed', 'Recovered', 'Down'])
      expect(text).toContain(name);
    expect(text.indexOf('Down')).toBeLessThan(text.indexOf('Recovered'));
    expect(text.indexOf('Recovered')).toBeLessThan(text.indexOf('Still down'));
    expect(text.indexOf('Still down')).toBeLessThan(text.indexOf('Reminders'));
    expect(text.indexOf('Reminders')).toBeLessThan(text.indexOf('Expiry warnings'));
    expect(text).not.toContain('https://example.com');
    if (template === 'matrix') {
      await notifier.sendSummary(webhook, contexts, 1000);
      expect(requests[0]?.url).not.toBe(requests[1]?.url);
    }
  },
);

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

it.each([100, 2000])(
  'bounds summaries with %i-character names and counts omitted alerts',
  async (length) => {
    let text = '';
    const webhook = { url: 'https://hooks.example/summary', payload: '$MSG' };
    const notifier = new WebhookNotifier(webhook, async (_url, options) => {
      text = JSON.parse(typeof options?.body === 'string' ? options.body : '') as string;
      return new Response('ok');
    });
    const contexts = Array.from({ length: 50 }, (_, i) =>
      context(i < 25 ? 'down' : 'expiry', `${i}`.padEnd(length, 'x')),
    );
    expect((await notifier.sendSummary(webhook, contexts)).success).toBe(true);
    expect(text.length).toBeLessThanOrEqual(1900);
    const listed = text.split('\n').filter((line) => line.startsWith('- '));
    expect(text.split('\n').pop()).toBe(`and ${50 - listed.length} more`);
    for (const line of listed)
      expect(
        contexts.some(
          (ctx) =>
            line === `- ${ctx.monitor.name}` || line === `- ${ctx.monitor.name}: Expires tomorrow`,
        ),
      ).toBe(true);
    expect(listed).toHaveLength(length === 100 ? 18 : 0);
  },
);

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
    expect((await notifier.sendSummary(webhook, contexts)).success).toBe(true);
    const text = requests[0]?.text ?? '';
    for (const name of ['Certificate', 'Reminder', 'Changed', 'Recovered', 'Down'])
      expect(text).toContain(name);
    expect(text.indexOf('Down')).toBeLessThan(text.indexOf('Recovered'));
    expect(text.indexOf('Recovered')).toBeLessThan(text.indexOf('Still down'));
    expect(text.indexOf('Still down')).toBeLessThan(text.indexOf('Reminders'));
    expect(text.indexOf('Reminders')).toBeLessThan(text.indexOf('Expiry warnings'));
    expect(text).not.toContain('https://example.com');
    if (template === 'discord') {
      const payload = JSON.parse(text) as {
        embeds: { fields: { name: string; value: string }[] }[];
      };
      expect(payload.embeds[0]?.fields.some((field) => field.name === 'Target')).toBe(false);
      expect(payload.embeds[0]?.fields.every((field) => field.value.length > 0)).toBe(true);
    }
    if (template === 'pushover')
      expect(new URLSearchParams(requests[0]?.text).has('url')).toBe(false);
    if (template === 'telegram') expect(text).not.toContain('<code></code>');
    if (template === 'zulip') expect(text).not.toContain('- Target: ');
    if (template === 'matrix') {
      await notifier.sendSummary(webhook, contexts);
      expect(requests[0]?.url).not.toBe(requests[1]?.url);
    }
  },
);

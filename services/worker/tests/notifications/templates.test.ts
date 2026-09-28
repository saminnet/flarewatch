import { describe, it, expect } from 'vite-plus/test';
import { NOTIFICATION_TEMPLATES, type JsonValue } from '@flarewatch/shared';
import { getTemplate } from '../../src/notifications/templates';
import type { TemplateContext } from '../../src/notifications/templates/types';
import { stripControlChars, singleLine } from '../../src/notifications/templates/format';

const baseContext: TemplateContext = {
  monitorName: 'Test Monitor',
  monitorId: 'test-monitor',
  targetUrl: 'https://example.com',
  isUp: false,
  isRecovery: false,
  isInitialOutage: true,
  downtimeMinutes: 5,
  reason: 'Connection refused',
  alsoDown: [],
  timestamp: '2025-01-15 12:00 UTC',
  timestampIso: '2025-01-15T12:00:00Z',
  incidentKey: 'test-monitor:1000',
  webhookUrl: 'https://hooks.example.com/webhook',
  options: {},
};

describe('notification templates', () => {
  const getSlackBlockText = (block: Record<string, JsonValue>): string => {
    const text = block.text;
    if (!text || typeof text !== 'object') return '';
    const maybeText = (text as { text?: unknown }).text;
    return typeof maybeText === 'string' ? maybeText : '';
  };

  it('telegram template escapes HTML-sensitive characters', () => {
    const template = getTemplate('telegram');

    const output = template({
      ...baseContext,
      monitorName: '<Monitor & "1">',
      reason: '<bad & "x">',
      targetUrl: 'https://example.com/?q=<>&x="y"&z=1',
    });

    const payload = JSON.parse(output.body) as { text: string; parse_mode: string };
    expect(payload.parse_mode).toBe('HTML');
    expect(payload.text).toContain('&lt;Monitor &amp; &quot;1&quot;&gt;');
    expect(payload.text).toContain('&lt;bad &amp; &quot;x&quot;&gt;');
    expect(payload.text).toContain('q=&lt;&gt;&amp;x=&quot;y&quot;&amp;z=1');
  });

  it('slack template escapes the reason, so a failure message cannot ping or link', () => {
    const output = getTemplate('slack')({
      ...baseContext,
      reason: 'HTTP 500 <!channel> <https://evil.example|log in> & more',
    });

    expect(output.body).toContain(
      'HTTP 500 &lt;!channel&gt; &lt;https://evil.example|log in&gt; &amp; more',
    );
    expect(output.body).not.toContain('<!channel>');
  });

  it('keeps a failure reason from pinging everyone or adding links in markup channels', () => {
    const reason = 'HTTP 500 @**all** <users/all> [log in](https://evil.example) `x`';
    const body = (template: Parameters<typeof getTemplate>[0]) =>
      decodeURIComponent(
        getTemplate(template)({ ...baseContext, reason }).body.replaceAll('+', ' '),
      );

    expect(body('zulip')).toContain(
      "- Reason: `HTTP 500 @**all** <users/all> [log in](https://evil.example) 'x'`",
    );
    expect(body('discord')).toContain(
      '"value":"`HTTP 500 @**all** <users/all> [log in](https://evil.example) \'x\'`"',
    );
    expect(body('googlechat')).toContain('‹users/all›');
    expect(body('googlechat')).not.toContain('<users/all>');
  });

  it('ntfy template maps status to priority and tags', () => {
    const ntfy = getTemplate('ntfy');

    const down = ntfy(baseContext);
    expect(down.headers.Title).toBe('Test Monitor is down');
    expect(down.headers.Priority).toBe('urgent');
    expect(down.headers.Tags).toBe('rotating_light');
    expect(down.body).toContain('Connection refused');
    expect(down.body).toContain('https://example.com');

    const recovered = ntfy({
      ...baseContext,
      isUp: true,
      isRecovery: true,
      isInitialOutage: false,
    });
    expect(recovered.headers.Title).toBe('Test Monitor is up');
    expect(recovered.headers.Priority).toBe('default');
    expect(recovered.headers.Tags).toBe('white_check_mark');
    expect(recovered.body).toContain('Recovered after 5 minutes');
  });

  it('ntfy template RFC 2047-encodes non-ASCII titles', () => {
    const ntfy = getTemplate('ntfy');

    const output = ntfy({ ...baseContext, monitorName: 'Überwachung' });
    const title = output.headers.Title ?? '';
    expect(title).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    // Headers constructor rejects non-ISO-8859-1 values; must not throw
    expect(() => new Headers(output.headers)).not.toThrow();
    expect(atob(title.slice(10, -2))).toBe(
      String.fromCharCode(...new TextEncoder().encode('Überwachung is down')),
    );
  });

  it('mattermost and rocketchat aliases produce the slack body', () => {
    const slack = getTemplate('slack')(baseContext);
    expect(getTemplate('mattermost')(baseContext).body).toBe(slack.body);
    expect(getTemplate('rocketchat')(baseContext).body).toBe(slack.body);
    expect(getTemplate('mattermost')(baseContext).method).toBe(slack.method);
  });

  it('teams template sends an Adaptive Card with down and up states', () => {
    const teams = getTemplate('teams');

    const down = teams(baseContext);
    expect(down.method).toBe('POST');
    expect(down.headers['Content-Type']).toBe('application/json');
    const downPayload = JSON.parse(down.body) as {
      type: string;
      attachments: Array<{
        contentType: string;
        content: {
          body: Array<{ text?: string }>;
        };
      }>;
    };
    expect(downPayload.type).toBe('message');
    expect(downPayload.attachments[0]?.contentType).toBe('application/vnd.microsoft.card.adaptive');
    const downCard = downPayload.attachments[0]?.content.body ?? [];
    expect(String(downCard[0]?.text)).toContain('🔴 Test Monitor is down');
    expect(JSON.stringify(downCard)).toContain('"Reason","value":"Connection refused"');

    const up = teams({ ...baseContext, isUp: true, isRecovery: true, isInitialOutage: false });
    const upPayload = JSON.parse(up.body) as typeof downPayload;
    const upCard = upPayload.attachments[0]?.content.body ?? [];
    expect(String(upCard[0]?.text)).toContain('✅ Test Monitor is up!');
    expect(JSON.stringify(upCard)).not.toContain('Reason');
  });

  it('googlechat template sends a text payload with down and up states', () => {
    const googleChat = getTemplate('googlechat');

    const down = googleChat(baseContext);
    expect(down.method).toBe('POST');
    expect(down.headers['Content-Type']).toBe('application/json');
    const downPayload = JSON.parse(down.body) as { text: string };
    expect(downPayload.text).toContain('🔴 *Test Monitor is down*');
    expect(downPayload.text).toContain('*Reason:* Connection refused');
    expect(downPayload.text).toContain('https://example.com');

    const up = googleChat({ ...baseContext, isUp: true, isRecovery: true, isInitialOutage: false });
    const upPayload = JSON.parse(up.body) as { text: string };
    expect(upPayload.text).toContain('✅ *Test Monitor is up!*');
    expect(upPayload.text).not.toContain('Reason');
  });

  it('matrix template PUTs the incident txn id into the configured URL', () => {
    const matrix = getTemplate('matrix');
    const ctx: TemplateContext = {
      ...baseContext,
      webhookUrl:
        'https://matrix.example.com/_matrix/client/v3/rooms/!room:example.com/send/m.room.message/?access_token=s3cret',
    };

    const down = matrix(ctx);
    expect(down.method).toBe('PUT');
    expect(down.headers['Content-Type']).toBe('application/json');
    expect(down.url).toBe(
      'https://matrix.example.com/_matrix/client/v3/rooms/!room:example.com/send/m.room.message/test-monitor%3A1000-down-2025-01-15T12%3A00%3A00Z?access_token=s3cret',
    );
    const downPayload = JSON.parse(down.body) as { msgtype: string; body: string };
    expect(downPayload.msgtype).toBe('m.text');
    expect(downPayload.body).toContain('🔴 Test Monitor is down');
    expect(downPayload.body).toContain('Connection refused');

    const up = matrix({ ...ctx, isUp: true, isRecovery: true, isInitialOutage: false });
    expect(up.url).toBe(
      'https://matrix.example.com/_matrix/client/v3/rooms/!room:example.com/send/m.room.message/test-monitor%3A1000-up-2025-01-15T12%3A00%3A00Z?access_token=s3cret',
    );

    const laterDown = matrix({ ...ctx, timestampIso: '2025-01-15T12:05:00Z' });
    expect(laterDown.url).not.toBe(down.url);
  });

  it('pushover template posts form fields with priority 1 on down', () => {
    const pushover = getTemplate('pushover');
    const ctx: TemplateContext = {
      ...baseContext,
      options: { token: 'app-token', user: 'user-key' },
    };

    const down = pushover(ctx);
    expect(down.method).toBe('POST');
    expect(down.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const downForm = new URLSearchParams(down.body);
    expect(downForm.get('token')).toBe('app-token');
    expect(downForm.get('user')).toBe('user-key');
    expect(downForm.get('title')).toBe('🔴 Test Monitor');
    expect(downForm.get('message')).toContain('Connection refused');
    expect(downForm.get('priority')).toBe('1');

    const up = pushover({ ...ctx, isUp: true, isRecovery: true, isInitialOutage: false });
    const upForm = new URLSearchParams(up.body);
    expect(upForm.get('priority')).toBe('0');
    expect(upForm.get('message')).toContain('Recovered after 5 minutes');
  });

  it('gotify template posts json with down and up priorities', () => {
    const gotify = getTemplate('gotify');

    const down = gotify(baseContext);
    expect(down.method).toBe('POST');
    expect(down.headers['Content-Type']).toBe('application/json');
    const downPayload = JSON.parse(down.body) as {
      title: string;
      message: string;
      priority: number;
    };
    expect(downPayload.title).toBe('🔴 Test Monitor');
    expect(downPayload.message).toContain('Connection refused');
    expect(downPayload.priority).toBe(8);

    const up = gotify({ ...baseContext, isUp: true, isRecovery: true, isInitialOutage: false });
    const upPayload = JSON.parse(up.body) as typeof downPayload;
    expect(upPayload.title).toBe('✅ Test Monitor');
    expect(upPayload.message).toContain('Recovered after 5 minutes');
    expect(upPayload.priority).toBe(0);
  });

  it('zulip template posts stream form fields from options', () => {
    const zulip = getTemplate('zulip');
    const ctx: TemplateContext = {
      ...baseContext,
      options: { to: 'alerts', topic: 'Uptime' },
    };

    const down = zulip(ctx);
    expect(down.method).toBe('POST');
    expect(down.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const downForm = new URLSearchParams(down.body);
    expect(downForm.get('type')).toBe('stream');
    expect(downForm.get('to')).toBe('alerts');
    expect(downForm.get('topic')).toBe('Uptime');
    expect(downForm.get('content')).toContain('🔴 **Test Monitor is down**');
    expect(downForm.get('content')).toContain('Connection refused');

    const up = zulip({ ...ctx, isUp: true, isRecovery: true, isInitialOutage: false });
    const upForm = new URLSearchParams(up.body);
    expect(upForm.get('content')).toContain('✅ **Test Monitor is up!**');
  });

  it('zulip template moves URL credentials into a Basic auth header', () => {
    const output = getTemplate('zulip')({
      ...baseContext,
      webhookUrl: 'https://bot%40example.com:s3cret@chat.example.com/api/v1/messages',
    });

    expect(output.url).toBe('https://chat.example.com/api/v1/messages');
    expect(output.headers.Authorization).toBe(`Basic ${btoa('bot@example.com:s3cret')}`);
    expect(() => new Request(output.url ?? '')).not.toThrow();
  });

  it('resend template posts an email payload from options', () => {
    const resend = getTemplate('resend');
    const ctx: TemplateContext = {
      ...baseContext,
      options: { from: 'alerts@example.com', to: 'ops@example.com' },
    };

    const down = resend(ctx);
    expect(down.method).toBe('POST');
    expect(down.headers['Content-Type']).toBe('application/json');
    const downPayload = JSON.parse(down.body) as {
      from: string;
      to: string;
      subject: string;
      text: string;
    };
    expect(downPayload.from).toBe('alerts@example.com');
    expect(downPayload.to).toBe('ops@example.com');
    expect(downPayload.subject).toBe('🔴 Test Monitor is down');
    expect(downPayload.text).toContain('Connection refused');

    const up = resend({ ...ctx, isUp: true, isRecovery: true, isInitialOutage: false });
    const upPayload = JSON.parse(up.body) as typeof downPayload;
    expect(upPayload.subject).toBe('✅ Test Monitor is up');
    expect(upPayload.text).toContain('Recovered after 5 minutes');
  });

  it.each([
    ['googlechat', (body: string) => body, 'Test Monitor is still down', '5 minutes'],
    ['matrix', (body: string) => body, 'Test Monitor is still down', '5 minutes'],
    ['teams', (body: string) => body, 'Test Monitor is still down', '5 min'],
    [
      'zulip',
      (body: string) => new URLSearchParams(body).get('content') ?? '',
      'Test Monitor is still down',
      '5 minutes',
    ],
    [
      'gotify',
      (body: string) => (JSON.parse(body) as { message: string }).message,
      'Down for',
      '5 minutes',
    ],
    [
      'pushover',
      (body: string) => new URLSearchParams(body).get('message') ?? '',
      'Down for',
      '5 minutes',
    ],
    [
      'resend',
      (body: string) => (JSON.parse(body) as { text: string }).text,
      'Down for',
      '5 minutes',
    ],
  ] as const)(
    '%s template renders an ongoing outage with its downtime',
    (templateName, notificationText, status, downtime) => {
      const output = getTemplate(templateName)({
        ...baseContext,
        isInitialOutage: false,
        isRecovery: false,
      });
      const body = notificationText(output.body);

      expect(body).toContain(status);
      expect(body).toContain(downtime);
    },
  );

  it('new templates strip control characters from monitor name and reason', () => {
    const ctx: TemplateContext = {
      ...baseContext,
      monitorName: 'Bad\u0000Monitor\nSecond\u0007',
      reason: 'line1\u001B[31mline2',
    };

    const teamsCard = JSON.parse(getTemplate('teams')(ctx).body) as {
      attachments: Array<{ content: { body: Array<{ text?: string }> } }>;
    };
    const teamsTitle = String(teamsCard.attachments[0]?.content.body[0]?.text);
    expect(teamsTitle).toBe('🔴 BadMonitor Second is down');

    expect(singleLine('a\r\nb')).toBe('a b');
    expect(stripControlChars('a\rb')).toBe('ab');
  });

  it('slack template includes reason section only when down with a reason', () => {
    const slack = getTemplate('slack');

    const downOutput = slack(baseContext);
    const downPayload = JSON.parse(downOutput.body) as {
      attachments: Array<{ blocks: Array<Record<string, JsonValue>> }>;
    };
    const downBlocks = downPayload.attachments[0]?.blocks ?? [];
    const hasReasonDown = downBlocks.some(
      (block) => block.type === 'section' && getSlackBlockText(block).includes('*Reason:*'),
    );
    expect(hasReasonDown).toBe(true);

    const upOutput = slack({ ...baseContext, isUp: true });
    const upPayload = JSON.parse(upOutput.body) as {
      attachments: Array<{ blocks: Array<Record<string, JsonValue>> }>;
    };
    const upBlocks = upPayload.attachments[0]?.blocks ?? [];
    const hasReasonUp = upBlocks.some(
      (block) => block.type === 'section' && getSlackBlockText(block).includes('*Reason:*'),
    );
    expect(hasReasonUp).toBe(false);
  });

  describe.each(NOTIFICATION_TEMPLATES)('%s', (name) => {
    const render = (ctx: Partial<TemplateContext>) => {
      const { body, headers } = getTemplate(name)({ ...baseContext, ...ctx });
      return decodeURIComponent(`${JSON.stringify(headers)}${body}`.replaceAll('+', ' '));
    };

    it('names the monitors down behind a down monitor', () => {
      expect(render({ alsoDown: ['App', 'Dashboard'] })).toMatch(/App`?, `?Dashboard/);
      expect(render({ alsoDown: [] })).not.toContain('Also down');
    });

    it('shortens a long list to fit chat field limits', () => {
      const names = Array.from(
        { length: 60 },
        (_, i) => `service-${String(i).padStart(2, '0')}-behind-proxy`,
      );
      const text = render({ alsoDown: names });

      expect(text).toContain('service-00-behind-proxy');
      expect(text).not.toContain('service-59-behind-proxy');
      expect(text).toMatch(/and \d+ more/);
    });

    it('leaves the list out of an up alert', () => {
      expect(
        render({ isUp: true, isRecovery: true, isInitialOutage: false, alsoDown: ['App'] }),
      ).not.toContain('Also down');
    });
  });

  it.each(['discord', 'zulip'] as const)(
    '%s puts each name behind the list in a code span, as it does the reason',
    (name) => {
      const { body } = getTemplate(name)({
        ...baseContext,
        alsoDown: ['@**all**', '[x](https://evil.example)'],
      });
      const text = decodeURIComponent(body.replaceAll('+', ' '));

      expect(text).toContain('`@**all**`, `[x](https://evil.example)`');
    },
  );
});

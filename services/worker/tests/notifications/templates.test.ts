import { describe, it, expect } from 'vitest';
import { getTemplate, hasTemplate, type TemplateContext } from '../../src/notifications/templates';

const baseContext: TemplateContext = {
  monitorName: 'Test Monitor',
  monitorId: 'test-monitor',
  targetUrl: 'https://example.com',
  isUp: false,
  isRecovery: false,
  isInitialOutage: true,
  downtimeMinutes: 5,
  reason: 'Connection refused',
  timestamp: '2025-01-15 12:00 UTC',
  timestampIso: '2025-01-15T12:00:00Z',
};

describe('notification templates', () => {
  const getSlackBlockText = (block: Record<string, unknown>): string => {
    const text = block.text;
    if (!text || typeof text !== 'object') return '';
    const maybeText = (text as { text?: unknown }).text;
    return typeof maybeText === 'string' ? maybeText : '';
  };

  it('hasTemplate recognizes built-in templates', () => {
    expect(hasTemplate('slack')).toBe(true);
    expect(hasTemplate('discord')).toBe(true);
    expect(hasTemplate('telegram')).toBe(true);
    expect(hasTemplate('text')).toBe(true);
    expect(hasTemplate('unknown')).toBe(false);
  });

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

  it('slack template includes reason section only when down with a reason', () => {
    const slack = getTemplate('slack');

    const downOutput = slack(baseContext);
    const downPayload = JSON.parse(downOutput.body) as {
      attachments: Array<{ blocks: Array<Record<string, unknown>> }>;
    };
    const downBlocks = downPayload.attachments[0]?.blocks ?? [];
    const hasReasonDown = downBlocks.some(
      (block) => block.type === 'section' && getSlackBlockText(block).includes('*Reason:*'),
    );
    expect(hasReasonDown).toBe(true);

    const upOutput = slack({ ...baseContext, isUp: true });
    const upPayload = JSON.parse(upOutput.body) as {
      attachments: Array<{ blocks: Array<Record<string, unknown>> }>;
    };
    const upBlocks = upPayload.attachments[0]?.blocks ?? [];
    const hasReasonUp = upBlocks.some(
      (block) => block.type === 'section' && getSlackBlockText(block).includes('*Reason:*'),
    );
    expect(hasReasonUp).toBe(false);
  });
});

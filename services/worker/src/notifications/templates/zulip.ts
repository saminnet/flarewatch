import type { TemplateContext, TemplateOutput } from './types';
import { stripControlChars } from './format';

export function zulipTemplate(ctx: TemplateContext): TemplateOutput {
  const emoji = ctx.isUp ? '✅' : '🔴';
  const state = ctx.isUp ? 'is up!' : ctx.isInitialOutage ? 'is down' : 'is still down';

  const lines: string[] = [
    `${emoji} **${stripControlChars(ctx.monitorName)} ${state}**`,
    `- Status: ${ctx.isUp ? 'Operational' : 'Down'}`,
    `- Duration: ${ctx.downtimeMinutes} minutes`,
  ];

  if (!ctx.isUp && ctx.reason) {
    lines.push(`- Reason: ${stripControlChars(ctx.reason)}`);
  }

  lines.push(`- Target: ${stripControlChars(ctx.targetUrl)}`, `- Time: ${ctx.timestamp}`);

  const form = new URLSearchParams({
    type: 'stream',
    to: ctx.options.to ?? '',
    topic: ctx.options.topic ?? 'Alerts',
    content: lines.join('\n'),
  });

  // fetch rejects URLs with embedded credentials, so move them to a Basic auth header.
  const url = new URL(ctx.webhookUrl);
  const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
  url.username = '';
  url.password = '';

  return {
    method: 'POST',
    url: url.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(credentials !== ':' && { Authorization: `Basic ${btoa(credentials)}` }),
    },
    body: form.toString(),
  };
}

import type { TemplateContext, TemplateOutput } from './types';
import { alsoDownList, stateText, statusText, inlineCode, stripControlChars } from './format';

export function zulipTemplate(ctx: TemplateContext): TemplateOutput {
  const up = ctx.kind === 'recovered';
  const emoji = up ? '✅' : '🔴';
  const state = stateText(ctx);

  const lines: string[] = [
    `${emoji} **${stripControlChars(ctx.monitorName)} ${state}**`,
    `- Status: ${statusText(ctx)}`,
    `- Duration: ${ctx.downtimeMinutes} minutes`,
  ];

  if (!up && ctx.reason) {
    lines.push(`- Reason: ${inlineCode(ctx.reason)}`);
  }

  const alsoDown = alsoDownList(ctx, inlineCode);
  if (alsoDown) lines.push(`- Also down: ${alsoDown}`);

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

import type { TemplateContext, TemplateOutput } from './types';
import { stripControlChars } from './format';

export function matrixTemplate(ctx: TemplateContext): TemplateOutput {
  const emoji = ctx.isUp ? '✅' : '🔴';
  const state = ctx.isUp ? 'is up!' : ctx.isInitialOutage ? 'is down' : 'is still down';

  const lines: string[] = [
    `${emoji} ${stripControlChars(ctx.monitorName)} ${state}`,
    `Status: ${ctx.isUp ? 'Operational' : 'Down'}`,
    `Duration: ${ctx.downtimeMinutes} minutes`,
  ];

  if (!ctx.isUp && ctx.reason) {
    lines.push(`Reason: ${stripControlChars(ctx.reason)}`);
  }

  lines.push(stripControlChars(ctx.targetUrl));

  // Matrix drops room events that reuse a transaction id, so each notification needs its own.
  const txnId = encodeURIComponent(
    `${ctx.incidentKey}-${ctx.isUp ? 'up' : 'down'}-${ctx.timestampIso}`,
  );
  const url = new URL(ctx.webhookUrl);
  url.pathname += `${url.pathname.endsWith('/') ? '' : '/'}${txnId}`;

  return {
    method: 'PUT',
    url: url.toString(),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'm.text', body: lines.join('\n') }),
  };
}

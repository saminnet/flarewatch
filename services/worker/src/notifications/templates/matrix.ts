import type { TemplateContext, TemplateOutput } from './types';
import { alsoDownList, stateText, statusText, stripControlChars } from './format';

export function matrixTemplate(ctx: TemplateContext): TemplateOutput {
  const up = ctx.kind === 'recovered';
  const emoji = up ? '✅' : '🔴';
  const state = stateText(ctx);

  const lines: string[] = [
    `${emoji} ${stripControlChars(ctx.monitorName)} ${state}`,
    `Status: ${statusText(ctx)}`,
    `Duration: ${ctx.downtimeMinutes} minutes`,
  ];

  if (!up && ctx.reason) {
    lines.push(`Reason: ${stripControlChars(ctx.reason)}`);
  }

  const alsoDown = alsoDownList(ctx);
  if (alsoDown) lines.push(`Also down: ${stripControlChars(alsoDown)}`);

  lines.push(stripControlChars(ctx.targetUrl));

  // Matrix drops room events that reuse a transaction id, so each notification needs its own.
  const txnId = encodeURIComponent(`${ctx.incidentKey}-${up ? 'up' : 'down'}-${ctx.timestampIso}`);
  const url = new URL(ctx.webhookUrl);
  url.pathname += `${url.pathname.endsWith('/') ? '' : '/'}${txnId}`;

  return {
    method: 'PUT',
    url: url.toString(),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'm.text', body: lines.join('\n') }),
  };
}

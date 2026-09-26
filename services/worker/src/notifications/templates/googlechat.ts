import type { TemplateContext, TemplateOutput } from './types';
import { jsonOutput, stripControlChars } from './format';

export function googleChatTemplate(ctx: TemplateContext): TemplateOutput {
  const emoji = ctx.isUp ? '✅' : '🔴';
  const state = ctx.isUp ? 'is up!' : ctx.isInitialOutage ? 'is down' : 'is still down';

  const lines: string[] = [
    `${emoji} *${stripControlChars(ctx.monitorName)} ${state}*`,
    `*Status:* ${ctx.isUp ? 'Operational' : 'Down'}`,
    `*Duration:* ${ctx.downtimeMinutes} minutes`,
  ];

  if (!ctx.isUp && ctx.reason) {
    lines.push(`*Reason:* ${stripControlChars(ctx.reason)}`);
  }

  lines.push(`${stripControlChars(ctx.targetUrl)} • ${ctx.timestamp}`);

  return jsonOutput({ text: lines.join('\n') });
}

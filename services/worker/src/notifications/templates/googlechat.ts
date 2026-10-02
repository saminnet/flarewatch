import type { TemplateContext, TemplateOutput } from './types';
import { alsoDownList, stateText, statusText, jsonOutput, stripControlChars } from './format';

export function googleChatTemplate(ctx: TemplateContext): TemplateOutput {
  const up = ctx.kind === 'recovered';
  const emoji = up ? '✅' : '🔴';
  const state = stateText(ctx);

  const lines: string[] = [
    `${emoji} *${stripControlChars(ctx.monitorName)} ${state}*`,
    `*Status:* ${statusText(ctx)}`,
    `*Duration:* ${ctx.downtimeMinutes} minutes`,
  ];

  if (!up && ctx.reason) {
    // Chat has no escape for <users/all> or <url|text>, so the brackets become look-alikes.
    lines.push(
      `*Reason:* ${stripControlChars(ctx.reason).replaceAll('<', '‹').replaceAll('>', '›')}`,
    );
  }

  const alsoDown = alsoDownList(ctx);
  if (alsoDown) {
    lines.push(
      `*Also down:* ${stripControlChars(alsoDown).replaceAll('<', '‹').replaceAll('>', '›')}`,
    );
  }

  lines.push(`${stripControlChars(ctx.targetUrl)} • ${ctx.timestamp}`);

  return jsonOutput({ text: lines.join('\n') });
}

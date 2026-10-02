import type { TemplateContext, TemplateOutput } from './types';
import { jsonOutput, notificationBody, singleLine, stateText, stripControlChars } from './format';

export function gotifyTemplate(ctx: TemplateContext): TemplateOutput {
  const up = ctx.kind === 'recovered';
  const state = ctx.kind === 'reminder' ? ` ${stateText(ctx)}` : '';
  const title = singleLine(`${up ? '✅' : '🔴'} ${ctx.monitorName}${state}`);

  const payload = {
    title,
    message: `${stripControlChars(notificationBody(ctx))}\n${stripControlChars(ctx.targetUrl)}`,
    priority: up ? 0 : 8,
  };

  return jsonOutput(payload);
}

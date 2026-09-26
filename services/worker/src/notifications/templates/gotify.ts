import type { TemplateContext, TemplateOutput } from './types';
import { jsonOutput, notificationBody, singleLine, stripControlChars } from './format';

export function gotifyTemplate(ctx: TemplateContext): TemplateOutput {
  const title = singleLine(`${ctx.isUp ? '✅' : '🔴'} ${ctx.monitorName}`);

  const payload = {
    title,
    message: `${stripControlChars(notificationBody(ctx))}\n${stripControlChars(ctx.targetUrl)}`,
    priority: ctx.isUp ? 0 : 8,
  };

  return jsonOutput(payload);
}

import type { TemplateContext, TemplateOutput } from './types';
import { jsonOutput, notificationBody, singleLine, stripControlChars } from './format';

export function resendTemplate(ctx: TemplateContext): TemplateOutput {
  const subject = singleLine(
    `${ctx.isUp ? '✅' : '🔴'} ${ctx.monitorName} ${ctx.isUp ? 'is up' : 'is down'}`,
  );

  const payload = {
    from: ctx.options.from ?? '',
    to: ctx.options.to ?? '',
    subject,
    text: `${stripControlChars(notificationBody(ctx))}\n\n${stripControlChars(ctx.targetUrl)}`,
  };

  return jsonOutput(payload);
}

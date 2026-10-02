import type { TemplateContext, TemplateOutput } from './types';
import { jsonOutput, notificationBody, singleLine, stateText, stripControlChars } from './format';

export function resendTemplate(ctx: TemplateContext): TemplateOutput {
  const up = ctx.kind === 'recovered';
  const state = up ? 'is up' : ctx.kind === 'reminder' ? stateText(ctx) : 'is down';
  const subject = singleLine(`${up ? '✅' : '🔴'} ${ctx.monitorName} ${state}`);

  const payload = {
    from: ctx.options.from ?? '',
    to: ctx.options.to ?? '',
    subject,
    text: `${stripControlChars(notificationBody(ctx))}\n\n${stripControlChars(ctx.targetUrl)}`,
  };

  return jsonOutput(payload);
}

import type { TemplateContext, TemplateOutput } from './types';
import { jsonOutput, notificationBody, singleLine, stateText, stripControlChars } from './format';

export function formatEmailAlert(ctx: TemplateContext) {
  const up = ctx.kind === 'recovered';
  const state = up
    ? 'is up'
    : ctx.kind === 'reminder' || ctx.kind === 'expiry' || ctx.kind === 'summary'
      ? stateText(ctx)
      : 'is down';
  const subject = singleLine(`${up ? '✅' : '🔴'} ${ctx.monitorName} ${state}`);
  const body = stripControlChars(notificationBody(ctx));
  const target = stripControlChars(ctx.targetUrl);
  const text = `${body}\n\n${target}`;
  return { subject, text };
}

export function resendTemplate(ctx: TemplateContext): TemplateOutput {
  const { subject, text } = formatEmailAlert(ctx);

  const payload = {
    from: ctx.options.from ?? '',
    to: ctx.options.to ?? '',
    subject,
    text,
  };

  return jsonOutput(payload);
}

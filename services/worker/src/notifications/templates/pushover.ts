import type { TemplateContext, TemplateOutput } from './types';
import { notificationBody, singleLine, stateText, stripControlChars } from './format';

export function pushoverTemplate(ctx: TemplateContext): TemplateOutput {
  const up = ctx.kind === 'recovered';
  const state = ctx.kind === 'reminder' ? ` ${stateText(ctx)}` : '';
  const title = singleLine(`${up ? '✅' : '🔴'} ${ctx.monitorName}${state}`);

  const form = new URLSearchParams({
    token: ctx.options.token ?? '',
    user: ctx.options.user ?? '',
    title,
    message: `${stripControlChars(notificationBody(ctx))}\n${stripControlChars(ctx.targetUrl)}`,
    priority: up ? '0' : '1',
    url: stripControlChars(ctx.targetUrl),
  });

  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  };
}

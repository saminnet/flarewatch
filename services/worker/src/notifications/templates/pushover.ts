import type { TemplateContext, TemplateOutput } from './types';
import { notificationBody, singleLine, stripControlChars } from './format';

export function pushoverTemplate(ctx: TemplateContext): TemplateOutput {
  const title = singleLine(`${ctx.isUp ? '✅' : '🔴'} ${ctx.monitorName}`);

  const form = new URLSearchParams({
    token: ctx.options.token ?? '',
    user: ctx.options.user ?? '',
    title,
    message: `${stripControlChars(notificationBody(ctx))}\n${stripControlChars(ctx.targetUrl)}`,
    priority: ctx.isUp ? '0' : '1',
    url: stripControlChars(ctx.targetUrl),
  });

  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  };
}

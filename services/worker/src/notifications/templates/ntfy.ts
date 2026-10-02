import type { TemplateContext, TemplateOutput } from './types';
import { notificationBody, stateText } from './format';

export function ntfyTemplate(ctx: TemplateContext): TemplateOutput {
  const up = ctx.kind === 'recovered';
  const title = `${ctx.monitorName} ${up ? 'is up' : stateText(ctx)}`;
  const body = notificationBody(ctx);

  return {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      Title: encodeHeaderValue(title),
      Priority: up ? 'default' : 'urgent',
      Tags: up ? 'white_check_mark' : 'rotating_light',
    },
    body: `${body}\n${ctx.targetUrl}`,
  };
}

/**
 * Header values outside printable ASCII are RFC 2047-encoded because ntfy decodes encoded words
 * and some Headers implementations reject wider Unicode.
 */
function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  return `=?UTF-8?B?${btoa(String.fromCharCode(...bytes))}?=`;
}

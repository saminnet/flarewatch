import type { TemplateContext, TemplateOutput } from './index';

export function ntfyTemplate(ctx: TemplateContext): TemplateOutput {
  let title: string;
  let body: string;

  if (ctx.isRecovery) {
    title = `${ctx.monitorName} is up`;
    body = `Recovered after ${ctx.downtimeMinutes} minutes of downtime.`;
  } else if (ctx.isInitialOutage) {
    title = `${ctx.monitorName} is down`;
    body = `Detected at ${ctx.timestamp}\nReason: ${ctx.reason || 'Unknown'}`;
  } else {
    title = `${ctx.monitorName} is still down`;
    body = `Down for ${ctx.downtimeMinutes} minutes\nReason: ${ctx.reason || 'Unknown'}`;
  }

  return {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      Title: encodeHeaderValue(title),
      Priority: ctx.isUp ? 'default' : 'urgent',
      Tags: ctx.isUp ? 'white_check_mark' : 'rotating_light',
    },
    body: `${body}\n${ctx.targetUrl}`,
  };
}

/**
 * Header values must be ASCII; non-ASCII monitor names would make the
 * Headers constructor throw. ntfy decodes RFC 2047 encoded words.
 */
function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  return `=?UTF-8?B?${btoa(String.fromCharCode(...bytes))}?=`;
}

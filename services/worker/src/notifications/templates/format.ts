import type { TemplateContext, TemplateOutput } from './types';

export function jsonOutput(body: unknown): TemplateOutput {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function notificationBody(ctx: TemplateContext): string {
  if (ctx.isRecovery) {
    return `Recovered after ${ctx.downtimeMinutes} minutes of downtime.`;
  }
  if (ctx.isInitialOutage) {
    return `Detected at ${ctx.timestamp}\nReason: ${ctx.reason || 'Unknown'}`;
  }
  return `Down for ${ctx.downtimeMinutes} minutes\nReason: ${ctx.reason || 'Unknown'}`;
}

// Preserve newlines and tabs used by notification formats.
export function stripControlChars(text: string): string {
  // oxlint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
}

export function singleLine(text: string): string {
  return stripControlChars(text).replace(/\s*\n\s*/g, ' ');
}

/** `&`, `<` and `>`, which Slack and Telegram both read as markup. */
export function escapeMarkup(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A code span, where Markdown chat apps render no mentions or links. */
export function inlineCode(text: string): string {
  return `\`${stripControlChars(text).replaceAll('`', "'")}\``;
}

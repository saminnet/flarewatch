import type { TemplateContext, TemplateOutput } from './types';

export function jsonOutput(body: unknown): TemplateOutput {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** " (reminder N)" on a reminder's title, nothing on another alert's. */
export function reminderNote(ctx: TemplateContext): string {
  return ctx.kind === 'reminder' ? ` (reminder ${String(ctx.reminder)})` : '';
}

/** What the alert says of the monitor, after its name. */
export function stateText(ctx: TemplateContext): string {
  if (ctx.kind === 'recovered') return 'is up!';
  return ctx.isInitialOutage ? 'is down' : `is still down${reminderNote(ctx)}`;
}

/** The value of a Status field. */
export function statusText(ctx: TemplateContext): string {
  if (ctx.kind === 'recovered') return 'Operational';
  return ctx.kind === 'reminder' ? 'Still down' : 'Down';
}

export function notificationBody(ctx: TemplateContext): string {
  if (ctx.kind === 'recovered') {
    return `Recovered after ${ctx.downtimeMinutes} minutes of downtime.`;
  }
  const lead = ctx.isInitialOutage
    ? `Detected at ${ctx.timestamp}`
    : `Down for ${ctx.downtimeMinutes} minutes`;
  return `${lead}\nReason: ${ctx.reason || 'Unknown'}${alsoDownSuffix(ctx)}`;
}

/** Leaves room under chat field limits; Discord's is 1,024 characters. */
const ALSO_DOWN_MAX_CHARS = 900;

/**
 * The names of the monitors down behind this one, each passed through `format`,
 * comma-separated and cut short with "and N more"; empty when there are none.
 */
export function alsoDownList(
  ctx: TemplateContext,
  format: (name: string) => string = (name) => name,
): string {
  if (ctx.kind === 'recovered') return '';
  const shown: string[] = [];
  let length = 0;
  for (const name of ctx.alsoDown) {
    const item = format(name);
    if (shown.length > 0 && length + item.length + 2 > ALSO_DOWN_MAX_CHARS) break;
    shown.push(item);
    length += item.length + 2;
  }
  const rest = ctx.alsoDown.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.join(', ');
}

/** A trailing "Also down" line for plain-text bodies. */
export function alsoDownSuffix(ctx: TemplateContext): string {
  const list = alsoDownList(ctx);
  return list ? `\nAlso down: ${list}` : '';
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

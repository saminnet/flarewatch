import type { TemplateContext, TemplateOutput } from './types';

export function telegramTemplate(ctx: TemplateContext): TemplateOutput {
  const emoji = ctx.isUp ? '✅' : '🔴';
  const status = ctx.isUp ? 'Operational' : 'Down';

  const lines: string[] = [
    `${emoji} <b>${escapeHtml(ctx.monitorName)}</b>`,
    '',
    `<b>Status:</b> ${status}`,
    `<b>Duration:</b> ${ctx.downtimeMinutes} minutes`,
  ];

  if (!ctx.isUp && ctx.reason) {
    lines.push(`<b>Reason:</b> ${escapeHtml(ctx.reason)}`);
  }

  lines.push('', `<code>${escapeHtml(ctx.targetUrl)}</code>`, `<i>${ctx.timestamp}</i>`);

  const payload = {
    text: lines.join('\n'),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

import type { TemplateContext, TemplateOutput } from './index';

export function discordTemplate(ctx: TemplateContext): TemplateOutput {
  // Discord uses decimal color values
  const color = ctx.isUp ? 0x36a64f : 0xdc3545;
  const emoji = ctx.isUp ? '✅' : '🔴';
  const status = ctx.isUp ? 'Operational' : 'Down';

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: 'Status', value: status, inline: true },
    { name: 'Duration', value: `${ctx.downtimeMinutes} minutes`, inline: true },
  ];

  if (!ctx.isUp && ctx.reason) {
    fields.push({ name: 'Reason', value: ctx.reason, inline: false });
  }

  fields.push({ name: 'Target', value: ctx.targetUrl, inline: false });

  const payload = {
    embeds: [
      {
        title: `${emoji} ${ctx.monitorName}`,
        color,
        fields,
        timestamp: ctx.timestampIso,
        footer: {
          text: 'FlareWatch',
        },
      },
    ],
  };

  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

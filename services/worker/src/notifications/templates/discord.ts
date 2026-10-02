import type { TemplateContext, TemplateOutput } from './types';
import { alsoDownList, inlineCode, jsonOutput, reminderNote, statusText } from './format';

export function discordTemplate(ctx: TemplateContext): TemplateOutput {
  const up = ctx.kind === 'recovered';
  // Discord uses decimal color values
  const color = up ? 0x36a64f : 0xdc3545;
  const emoji = up ? '✅' : '🔴';
  const status = statusText(ctx);

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: 'Status', value: status, inline: true },
    { name: 'Duration', value: `${ctx.downtimeMinutes} minutes`, inline: true },
  ];

  if (!up && ctx.reason) {
    fields.push({ name: 'Reason', value: inlineCode(ctx.reason), inline: false });
  }

  const alsoDown = alsoDownList(ctx, inlineCode);
  if (alsoDown) fields.push({ name: 'Also down', value: alsoDown, inline: false });

  fields.push({ name: 'Target', value: ctx.targetUrl, inline: false });

  const payload = {
    embeds: [
      {
        title: `${emoji} ${ctx.monitorName}${reminderNote(ctx)}`,
        color,
        fields,
        timestamp: ctx.timestampIso,
        footer: {
          text: 'FlareWatch',
        },
      },
    ],
  };

  return jsonOutput(payload);
}

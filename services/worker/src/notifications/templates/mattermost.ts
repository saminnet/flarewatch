import type { TemplateContext, TemplateOutput } from './types';
import {
  alsoDownList,
  inlineCode,
  jsonOutput,
  reminderNote,
  singleLine,
  statusText,
} from './format';

/** Mattermost and Rocket.Chat take Slack's attachment fields, not its blocks. */
export function mattermostTemplate(ctx: TemplateContext): TemplateOutput {
  const up = ctx.kind === 'recovered';
  const title = singleLine(`${up ? '✅' : '🔴'} ${ctx.monitorName}${reminderNote(ctx)}`);
  const status = statusText(ctx);
  const fields = [
    { title: 'Status', value: status, short: true },
    { title: 'Duration', value: `${ctx.downtimeMinutes} min`, short: true },
  ];
  if (!up && ctx.reason)
    fields.push({ title: 'Reason', value: inlineCode(ctx.reason), short: false });
  const alsoDown = alsoDownList(ctx, inlineCode);
  if (alsoDown) fields.push({ title: 'Also down', value: alsoDown, short: false });

  return jsonOutput({
    attachments: [
      {
        fallback: `${title}: ${status}`,
        color: up ? '#36a64f' : '#dc3545',
        title,
        fields,
        footer: `${ctx.targetUrl} • ${ctx.timestamp}`,
      },
    ],
  });
}

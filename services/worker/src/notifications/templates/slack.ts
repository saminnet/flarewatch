import type { TemplateContext, TemplateOutput } from './types';
import { alsoDownList, escapeMarkup, jsonOutput, reminderNote, statusText } from './format';

export function slackTemplate(ctx: TemplateContext): TemplateOutput {
  const up = ctx.kind === 'recovered';
  const color = up ? '#36a64f' : '#dc3545';
  const status = statusText(ctx);

  const blocks: unknown[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${up ? '✅' : '🔴'} ${ctx.monitorName}${reminderNote(ctx)}`,
        emoji: true,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Status:*\n${status}`,
        },
        {
          type: 'mrkdwn',
          text: `*Duration:*\n${ctx.downtimeMinutes} min`,
        },
      ],
    },
  ];

  if (!up && ctx.reason) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Reason:*\n${escapeMarkup(ctx.reason)}`,
      },
    });
  }

  const alsoDown = alsoDownList(ctx);
  if (alsoDown) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Also down:*\n${escapeMarkup(alsoDown)}` },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `${ctx.targetUrl} • ${ctx.timestamp}`,
      },
    ],
  });

  const payload = {
    attachments: [
      {
        color,
        blocks,
      },
    ],
  };

  return jsonOutput(payload);
}

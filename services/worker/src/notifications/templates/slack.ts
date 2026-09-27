import type { TemplateContext, TemplateOutput } from './types';
import { escapeMarkup, jsonOutput } from './format';

export function slackTemplate(ctx: TemplateContext): TemplateOutput {
  const color = ctx.isUp ? '#36a64f' : '#dc3545';
  const status = ctx.isUp ? 'Operational' : 'Down';

  const blocks: unknown[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${ctx.isUp ? '✅' : '🔴'} ${ctx.monitorName}`,
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

  if (!ctx.isUp && ctx.reason) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Reason:*\n${escapeMarkup(ctx.reason)}`,
      },
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

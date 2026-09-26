import type { TemplateContext, TemplateOutput } from './types';
import { jsonOutput, singleLine, stripControlChars } from './format';

export function teamsTemplate(ctx: TemplateContext): TemplateOutput {
  const emoji = ctx.isUp ? '✅' : '🔴';
  const state = ctx.isUp ? 'is up!' : ctx.isInitialOutage ? 'is down' : 'is still down';
  const name = singleLine(ctx.monitorName);

  const facts: { title: string; value: string }[] = [
    { title: 'Status', value: ctx.isUp ? 'Operational' : 'Down' },
    { title: 'Duration', value: `${ctx.downtimeMinutes} min` },
  ];

  if (!ctx.isUp && ctx.reason) {
    facts.push({ title: 'Reason', value: stripControlChars(ctx.reason) });
  }

  const payload = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              size: 'Medium',
              weight: 'Bolder',
              wrap: true,
              color: ctx.isUp ? 'Good' : 'Attention',
              text: `${emoji} ${name} ${state}`,
            },
            {
              type: 'FactSet',
              facts,
            },
            {
              type: 'TextBlock',
              isSubtle: true,
              wrap: true,
              spacing: 'None',
              text: `${stripControlChars(ctx.targetUrl)} • ${ctx.timestamp}`,
            },
          ],
        },
      },
    ],
  };

  return jsonOutput(payload);
}

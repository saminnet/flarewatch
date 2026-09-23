import type { NotificationTemplate } from '@flarewatch/shared';
import type { TemplateContext, TemplateOutput } from './types';
import { slackTemplate } from './slack';
import { discordTemplate } from './discord';
import { telegramTemplate } from './telegram';
import { ntfyTemplate } from './ntfy';

type TemplateFunction = (ctx: TemplateContext) => TemplateOutput;

function textTemplate(ctx: TemplateContext): TemplateOutput {
  const emoji = ctx.isUp ? '✅' : '🔴';
  const status = ctx.isUp ? 'up' : 'down';

  let text: string;
  if (ctx.isRecovery) {
    text = `${emoji} ${ctx.monitorName} is up!\nRecovered after ${ctx.downtimeMinutes} minutes of downtime.`;
  } else if (ctx.isInitialOutage) {
    text = `${emoji} ${ctx.monitorName} is ${status}\nDetected at ${ctx.timestamp}\nReason: ${ctx.reason || 'Unknown'}`;
  } else {
    text = `${emoji} ${ctx.monitorName} is still ${status}\nDown for ${ctx.downtimeMinutes} minutes\nReason: ${ctx.reason || 'Unknown'}`;
  }

  return {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: text,
  };
}

const templates = {
  slack: slackTemplate,
  discord: discordTemplate,
  telegram: telegramTemplate,
  ntfy: ntfyTemplate,
  text: textTemplate,
} satisfies Record<NotificationTemplate, TemplateFunction>;

export function getTemplate(name: NotificationTemplate): TemplateFunction {
  return templates[name];
}

export function hasTemplate(name: string): name is NotificationTemplate {
  return Object.prototype.hasOwnProperty.call(templates, name);
}

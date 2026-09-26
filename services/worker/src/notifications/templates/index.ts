import type { NotificationTemplate } from '@flarewatch/shared';
import type { TemplateContext, TemplateOutput } from './types';
import { slackTemplate } from './slack';
import { discordTemplate } from './discord';
import { telegramTemplate } from './telegram';
import { ntfyTemplate } from './ntfy';
import { teamsTemplate } from './teams';
import { googleChatTemplate } from './googlechat';
import { matrixTemplate } from './matrix';
import { pushoverTemplate } from './pushover';
import { gotifyTemplate } from './gotify';
import { zulipTemplate } from './zulip';
import { resendTemplate } from './resend';

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
  teams: teamsTemplate,
  googlechat: googleChatTemplate,
  matrix: matrixTemplate,
  pushover: pushoverTemplate,
  gotify: gotifyTemplate,
  zulip: zulipTemplate,
  resend: resendTemplate,
  mattermost: slackTemplate,
  rocketchat: slackTemplate,
} satisfies Record<NotificationTemplate, TemplateFunction>;

export function getTemplate(name: NotificationTemplate): TemplateFunction {
  return templates[name];
}

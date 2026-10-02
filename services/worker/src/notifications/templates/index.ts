import type { NotificationTemplate } from '@flarewatch/shared';
import type { TemplateContext, TemplateOutput } from './types';
import { notificationBody, stateText } from './format';
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
  const emoji = ctx.kind === 'recovered' ? '✅' : '🔴';
  return {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: `${emoji} ${ctx.monitorName} ${stateText(ctx)}\n${notificationBody(ctx)}`,
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

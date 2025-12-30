import type { NotificationTemplate } from '@flarewatch/shared';
import { slackTemplate } from './slack';
import { discordTemplate } from './discord';
import { telegramTemplate } from './telegram';

/** Context passed to templates for formatting */
export interface TemplateContext {
  monitorName: string;
  monitorId: string;
  targetUrl: string;
  isUp: boolean;
  isRecovery: boolean;
  isInitialOutage: boolean;
  downtimeMinutes: number;
  reason: string;
  timestamp: string;
  timestampIso: string;
}

/** Output from a template - ready to send */
export interface TemplateOutput {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body: string;
}

/** Template function signature */
export type TemplateFunction = (ctx: TemplateContext) => TemplateOutput;

/** Plain text template (default fallback) */
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

/** Template registry */
const templates: Record<NotificationTemplate, TemplateFunction> = {
  slack: slackTemplate,
  discord: discordTemplate,
  telegram: telegramTemplate,
  text: textTemplate,
};

/** Get a template by name */
export function getTemplate(name: NotificationTemplate): TemplateFunction {
  return templates[name] ?? textTemplate;
}

/** Check if a template exists */
export function hasTemplate(name: string): name is NotificationTemplate {
  return Object.prototype.hasOwnProperty.call(templates, name);
}

import {
  type JsonValue,
  type Monitor,
  type Webhook,
  type WebhookConfig,
  fetchWithTimeout,
  type Fetcher,
  createLogger,
  getErrorMessage,
  isJsonObject,
  readTextUpTo,
  toHeaders,
} from '@flarewatch/shared';
import { getTemplate } from './templates';
import type { TemplateContext } from './templates/types';

const log = createLogger('Webhook');

function createDateFormatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  });
}

export interface NotificationContext {
  monitor: Monitor;
  isUp: boolean;
  incidentStartTime: number;
  currentTime: number;
  reason: string;
  timeZone: string;
  /** Monitors behind this one that are down with it; their own alerts are held back. */
  alsoDown: string[];
}

interface WebhookResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

export function formatNotificationMessage(ctx: NotificationContext): string {
  const { monitor, isUp, incidentStartTime, currentTime, reason, timeZone } = ctx;
  const formatter = createDateFormatter(timeZone);
  const downtimeMinutes = Math.round((currentTime - incidentStartTime) / 60);
  const currentTimeFormatted = formatter.format(new Date(currentTime * 1000));
  const incidentStartFormatted = formatter.format(new Date(incidentStartTime * 1000));

  if (isUp) {
    return [
      `✅ ${monitor.name} is up!`,
      `The service recovered after ${downtimeMinutes} minutes of downtime.`,
    ].join('\n');
  }

  const alsoDown = ctx.alsoDown.length > 0 ? [`Also down: ${ctx.alsoDown.join(', ')}`] : [];
  if (currentTime === incidentStartTime) {
    return [
      `🔴 ${monitor.name} is down`,
      `Detected at ${currentTimeFormatted}`,
      `Reason: ${reason || 'Unknown'}`,
      ...alsoDown,
    ].join('\n');
  }

  return [
    `🔴 ${monitor.name} is still down`,
    `Down since ${incidentStartFormatted} (${downtimeMinutes} minutes)`,
    `Reason: ${reason || 'Unknown'}`,
    ...alsoDown,
  ].join('\n');
}

function applyTemplate(payload: JsonValue, message: string): JsonValue {
  if (payload === '$MSG') {
    return message;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => applyTemplate(item, message));
  }

  if (isJsonObject(payload)) {
    const result: { [key: string]: JsonValue } = {};
    for (const [key, value] of Object.entries(payload)) {
      result[key] = applyTemplate(value, message);
    }
    return result;
  }

  return payload;
}

/**
 * An array repeats its key, the way an HTML form sends a multi-value field. An object has no form
 * representation, so it goes as JSON. `null` sends an empty field, not the text "null".
 */
function appendParams(target: URLSearchParams, payload: JsonValue | undefined): void {
  if (!isJsonObject(payload)) return;
  for (const [key, value] of Object.entries(payload)) {
    appendFormValue(target, key, value);
  }
}

function appendFormValue(target: URLSearchParams, key: string, value: JsonValue): void {
  if (Array.isArray(value)) {
    for (const item of value) appendFormValue(target, key, item);
    return;
  }
  if (value === null) {
    target.append(key, '');
    return;
  }
  target.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
}

/**
 * Text bound for the logs, without the webhook's URL or header values, which often carry its
 * secret. A short header value is no secret and masking it would garble the text.
 */
function redact(text: string, webhook: Webhook, finalUrl: string): string {
  const masked = [finalUrl, webhook.url].reduce(
    (result, secret) => result.replaceAll(secret, '<webhook URL>'),
    text,
  );
  return Object.values(webhook.headers ?? {})
    .flatMap((value) => [String(value), String(value).split(' ').pop() ?? ''])
    .filter((secret) => secret.length >= 8)
    .reduce((result, secret) => result.replaceAll(secret, '<header>'), masked);
}

export function buildTemplateContext(ctx: NotificationContext, webhook: Webhook): TemplateContext {
  const { monitor, isUp, incidentStartTime, currentTime, reason, timeZone } = ctx;
  const formatter = createDateFormatter(timeZone);
  const downtimeMinutes = Math.round((currentTime - incidentStartTime) / 60);
  const timestamp = formatter.format(new Date(currentTime * 1000));
  const timestampIso = new Date(currentTime * 1000).toISOString();

  return {
    monitorName: monitor.name,
    monitorId: monitor.id,
    targetUrl:
      'target' in monitor ? monitor.target : typeof monitor.link === 'string' ? monitor.link : '',
    isUp,
    isRecovery: isUp && currentTime !== incidentStartTime,
    isInitialOutage: !isUp && currentTime === incidentStartTime,
    downtimeMinutes,
    reason: reason || 'Unknown',
    alsoDown: ctx.alsoDown,
    timestamp,
    timestampIso,
    incidentKey: `${monitor.id}:${incidentStartTime}`,
    webhookUrl: webhook.url,
    options: webhook.options ?? {},
  };
}

export class WebhookNotifier {
  constructor(
    private config: WebhookConfig,
    private readonly fetcher: Fetcher = fetchWithTimeout,
  ) {}

  async send(ctx: NotificationContext, message: string): Promise<WebhookResult[]> {
    const configs = Array.isArray(this.config) ? this.config : [this.config];
    const results = await Promise.all(configs.map((cfg) => this.sendSingle(cfg, ctx, message)));
    return results;
  }

  private async sendSingle(
    webhook: Webhook,
    ctx: NotificationContext,
    message: string,
  ): Promise<WebhookResult> {
    const { url, template, method, headers, payload, payloadType, timeout = 5000 } = webhook;
    let finalUrl = url;
    try {
      let requestInit: RequestInit;

      if (template) {
        const templateCtx = buildTemplateContext(ctx, webhook);
        const output = getTemplate(template)(templateCtx);

        const requestHeaders = toHeaders(headers);
        for (const [key, value] of Object.entries(output.headers)) {
          if (!requestHeaders.has(key)) {
            requestHeaders.set(key, value);
          }
        }

        finalUrl = output.url ?? finalUrl;

        requestInit = {
          method: method ?? output.method,
          headers: requestHeaders,
          body: output.body,
        };
      } else {
        // `param`/`x-www-form-urlencoded` need an object payload; reject early rather than
        // send a silently empty alert.
        if (payloadType !== undefined && payloadType !== 'json' && !isJsonObject(payload)) {
          return { success: false, error: `Webhook payloadType '${payloadType}' needs a payload` };
        }

        const templatedPayload =
          payload === undefined ? undefined : applyTemplate(payload, message);

        requestInit = this.buildRequest(payloadType ?? 'json', method, headers, templatedPayload);

        if (payloadType === 'param') {
          const urlWithParams = new URL(url);
          appendParams(urlWithParams.searchParams, templatedPayload);
          finalUrl = urlWithParams.toString();
        }
      }

      // The host only: a webhook URL often carries its secret (Telegram, Slack, Discord).
      log.info('Sending', { host: new URL(finalUrl).host });

      const response = await this.fetcher(finalUrl, {
        ...requestInit,
        timeout,
      });

      if (!response.ok) {
        const body = redact(await readTextUpTo(response, 4096), webhook, finalUrl);
        log.info('Failed', { status: response.status, body: body.slice(0, 200) });
        return {
          success: false,
          statusCode: response.status,
          error: `HTTP ${response.status}`,
        };
      }

      log.info('Success', { status: response.status });
      return { success: true, statusCode: response.status };
    } catch (error) {
      // A fetch error can quote the URL.
      const message = redact(getErrorMessage(error), webhook, finalUrl);
      log.error('Error', { error: message });
      return { success: false, error: message };
    }
  }

  private buildRequest(
    payloadType: string,
    method: string | undefined,
    headers: Webhook['headers'],
    payload: JsonValue | undefined,
  ): RequestInit {
    const requestHeaders = toHeaders(headers);

    switch (payloadType) {
      case 'json': {
        if (!requestHeaders.has('content-type')) {
          requestHeaders.set('content-type', 'application/json');
        }
        return {
          method: method ?? 'POST',
          headers: requestHeaders,
          body: JSON.stringify(payload),
        };
      }

      case 'x-www-form-urlencoded': {
        if (!requestHeaders.has('content-type')) {
          requestHeaders.set('content-type', 'application/x-www-form-urlencoded');
        }
        const formData = new URLSearchParams();
        appendParams(formData, payload);
        return {
          method: method ?? 'POST',
          headers: requestHeaders,
          body: formData.toString(),
        };
      }

      case 'param':
      default:
        return {
          method: method ?? 'GET',
          headers: requestHeaders,
        };
    }
  }
}

export function createNotifier(
  config: WebhookConfig | undefined,
  fetcher: Fetcher = fetchWithTimeout,
): WebhookNotifier | null {
  // An empty list would mark outages as alerted with nowhere to send them.
  if (!config || (Array.isArray(config) && config.length === 0)) return null;
  return new WebhookNotifier(config, fetcher);
}

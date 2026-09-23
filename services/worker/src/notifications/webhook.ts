import {
  type JsonValue,
  type MonitorTarget,
  type Webhook,
  type WebhookConfig,
  fetchWithTimeout,
  type Fetcher,
  createLogger,
  getErrorMessage,
  isJsonObject,
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
  monitor: MonitorTarget;
  isUp: boolean;
  incidentStartTime: number;
  currentTime: number;
  reason: string;
  timeZone: string;
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

  if (currentTime === incidentStartTime) {
    return [
      `🔴 ${monitor.name} is down`,
      `Detected at ${currentTimeFormatted}`,
      `Reason: ${reason || 'Unknown'}`,
    ].join('\n');
  }

  return [
    `🔴 ${monitor.name} is still down`,
    `Down since ${incidentStartFormatted} (${downtimeMinutes} minutes)`,
    `Reason: ${reason || 'Unknown'}`,
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

function buildTemplateContext(ctx: NotificationContext): TemplateContext {
  const { monitor, isUp, incidentStartTime, currentTime, reason, timeZone } = ctx;
  const formatter = createDateFormatter(timeZone);
  const downtimeMinutes = Math.round((currentTime - incidentStartTime) / 60);
  const timestamp = formatter.format(new Date(currentTime * 1000));
  const timestampIso = new Date(currentTime * 1000).toISOString();

  return {
    monitorName: monitor.name,
    monitorId: monitor.id,
    targetUrl: monitor.target,
    isUp,
    isRecovery: isUp && currentTime !== incidentStartTime,
    isInitialOutage: !isUp && currentTime === incidentStartTime,
    downtimeMinutes,
    reason: reason || 'Unknown',
    timestamp,
    timestampIso,
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
    try {
      const { url, template, method, headers, payload, payloadType, timeout = 5000 } = webhook;

      let requestInit: RequestInit;
      let finalUrl = url;

      if (template) {
        const templateCtx = buildTemplateContext(ctx);
        const output = getTemplate(template)(templateCtx);

        const requestHeaders = toHeaders(headers);
        for (const [key, value] of Object.entries(output.headers)) {
          if (!requestHeaders.has(key)) {
            requestHeaders.set(key, value);
          }
        }

        requestInit = {
          method: method ?? output.method,
          headers: requestHeaders,
          body: output.body,
        };
      } else {
        // `param` and `x-www-form-urlencoded` carry the message in the payload object. Anything
        // that is not an object encodes to nothing, and a silently empty alert is worse than a
        // reported failure.
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

      log.info('Sending', { url: finalUrl });

      const response = await this.fetcher(finalUrl, {
        ...requestInit,
        timeout,
      });

      if (!response.ok) {
        const body = await response.text();
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
      const message = getErrorMessage(error);
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
  if (!config) return null;
  return new WebhookNotifier(config, fetcher);
}

import {
  type MonitorTarget,
  type WebhookConfig,
  fetchWithTimeout,
  createLogger,
  getErrorMessage,
} from '@flarewatch/shared';
import { getTemplate, type TemplateContext } from './templates';

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

export interface WebhookResult {
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

function applyMessageTemplate(payload: unknown, message: string): unknown {
  if (payload === '$MSG') {
    return message;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => applyMessageTemplate(item, message));
  }

  if (typeof payload === 'object' && payload !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      result[key] = applyMessageTemplate(value, message);
    }
    return result;
  }

  return payload;
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
  constructor(private config: WebhookConfig) {}

  async send(ctx: NotificationContext, message: string): Promise<WebhookResult[]> {
    const configs = Array.isArray(this.config) ? this.config : [this.config];
    const results = await Promise.all(configs.map((cfg) => this.sendSingle(cfg, ctx, message)));
    return results;
  }

  private async sendSingle(
    webhook: Exclude<WebhookConfig, Array<unknown>>,
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

        const requestHeaders = new Headers(headers as Record<string, string> | undefined);
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
        const templatedPayload = applyMessageTemplate(payload, message);

        requestInit = this.buildRequest(
          payloadType ?? 'json',
          method,
          headers as Record<string, string> | undefined,
          templatedPayload,
        );

        if (payloadType === 'param') {
          finalUrl = this.buildUrlWithParams(url, templatedPayload as Record<string, unknown>);
        }
      }

      log.info('Sending', { url: finalUrl });

      const response = await fetchWithTimeout(finalUrl, {
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
    headers: Record<string, string> | undefined,
    payload: unknown,
  ): RequestInit {
    const requestHeaders = new Headers(headers);

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
        for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
          formData.append(key, String(value));
        }
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

  private buildUrlWithParams(baseUrl: string, params: Record<string, unknown>): string {
    const url = new URL(baseUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.append(key, String(value));
    }
    return url.toString();
  }
}

export function createNotifier(config: WebhookConfig | undefined): WebhookNotifier | null {
  if (!config) return null;
  return new WebhookNotifier(config);
}

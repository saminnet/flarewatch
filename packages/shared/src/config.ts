import type {
  RuntimeConfig,
  Monitor,
  StatusPageConfig,
  RuntimeConfigEnvelope,
  NotificationConfig,
  Webhook,
  Maintenance,
  KvStore,
} from './types';
import { KV_KEYS } from './types';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const WEBHOOK_TEMPLATES = new Set(['slack', 'discord', 'telegram', 'ntfy', 'text']);
const WEBHOOK_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH']);
const WEBHOOK_PAYLOAD_TYPES = new Set(['param', 'json', 'x-www-form-urlencoded']);

function isConfigRecord(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidHostPort(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  try {
    const url = new URL(`http://${trimmed}`);
    if (!url.hostname || !url.port) return false;
    if (url.username || url.password) return false;
    if (url.pathname !== '/' || url.search || url.hash) return false;

    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return false;

    return true;
  } catch {
    return false;
  }
}

function isValidMonitorTarget(target: string, method?: string): boolean {
  const trimmed = target.trim();
  if (!trimmed) return false;

  if (!method) {
    return isValidHttpUrl(trimmed);
  }

  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === 'TCP_PING') {
    return isValidHostPort(trimmed);
  }

  if (HTTP_METHODS.has(normalizedMethod)) {
    return isValidHttpUrl(trimmed);
  }

  return true;
}

function isValidWebhookHeaders(value: unknown): boolean {
  if (!isConfigRecord(value)) return false;
  return Object.values(value).every(
    (entry) => typeof entry === 'string' || typeof entry === 'number',
  );
}

function isValidWebhook(value: unknown): value is Webhook {
  if (!isConfigRecord(value)) return false;

  if (!('url' in value) || typeof value.url !== 'string' || !isValidHttpUrl(value.url))
    return false;
  if ('template' in value && value.template !== undefined) {
    if (typeof value.template !== 'string' || !WEBHOOK_TEMPLATES.has(value.template)) return false;
  }
  if ('method' in value && value.method !== undefined) {
    if (typeof value.method !== 'string' || !WEBHOOK_METHODS.has(value.method.toUpperCase()))
      return false;
  }
  if ('headers' in value && value.headers !== undefined && !isValidWebhookHeaders(value.headers))
    return false;
  if ('payloadType' in value && value.payloadType !== undefined) {
    if (typeof value.payloadType !== 'string' || !WEBHOOK_PAYLOAD_TYPES.has(value.payloadType))
      return false;
  }
  if ('timeout' in value && value.timeout !== undefined && typeof value.timeout !== 'number')
    return false;

  return true;
}

function isOptionalType<T>(value: unknown, check: (v: unknown) => v is T): value is T | undefined {
  return value === undefined || check(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isValidMaintenance(value: unknown): value is Maintenance {
  if (!isConfigRecord(value)) return false;

  if (!('id' in value) || typeof value.id !== 'string' || value.id.length === 0) return false;
  if (!('body' in value) || typeof value.body !== 'string' || value.body.length === 0) return false;
  if (!('createdAt' in value) || typeof value.createdAt !== 'number') return false;
  if (!Number.isFinite(value.createdAt)) return false;
  if (!('updatedAt' in value) || typeof value.updatedAt !== 'number') return false;
  if (!Number.isFinite(value.updatedAt)) return false;
  if (!('start' in value) || !(typeof value.start === 'string' || typeof value.start === 'number'))
    return false;
  if (
    'end' in value &&
    value.end !== undefined &&
    !(typeof value.end === 'string' || typeof value.end === 'number')
  ) {
    return false;
  }
  if ('title' in value && !isOptionalType(value.title, isString)) return false;
  if ('color' in value && !isOptionalType(value.color, isString)) return false;
  if ('monitors' in value && !isOptionalType(value.monitors, isStringArray)) return false;

  return true;
}

export function parseMaintenances(value: unknown): Maintenance[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Maintenance => isValidMaintenance(item));
}

function isValidNotificationConfig(value: unknown): value is NotificationConfig {
  if (!isConfigRecord(value)) return false;

  if ('webhook' in value && value.webhook !== undefined) {
    const webhooks = Array.isArray(value.webhook) ? value.webhook : [value.webhook];
    if (!webhooks.every(isValidWebhook)) return false;
  }

  if ('timeZone' in value && !isOptionalType(value.timeZone, isString)) return false;
  if ('gracePeriod' in value && !isOptionalType(value.gracePeriod, isNumber)) return false;
  if ('skipNotificationIds' in value && !isOptionalType(value.skipNotificationIds, isStringArray))
    return false;
  if (
    'skipErrorChangeNotification' in value &&
    !isOptionalType(value.skipErrorChangeNotification, isBoolean)
  )
    return false;

  return true;
}

function isValidMonitor(value: unknown): value is Monitor {
  if (!isConfigRecord(value)) return false;

  return (
    'id' in value &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    'name' in value &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    'method' in value &&
    typeof value.method === 'string' &&
    'target' in value &&
    typeof value.target === 'string' &&
    isValidMonitorTarget(value.target, value.method)
  );
}

function isValidStatusPageConfig(value: unknown): value is StatusPageConfig {
  if (!isConfigRecord(value)) return false;
  return !('title' in value) || isOptionalType(value.title, isString);
}

export function isValidRuntimeConfig(value: unknown): value is RuntimeConfig {
  if (!isConfigRecord(value)) return false;

  if (!('monitors' in value) || !Array.isArray(value.monitors)) return false;
  if (!value.monitors.every(isValidMonitor)) return false;
  if (
    'statusPage' in value &&
    value.statusPage !== undefined &&
    !isValidStatusPageConfig(value.statusPage)
  )
    return false;
  if (
    'notification' in value &&
    value.notification !== undefined &&
    !isValidNotificationConfig(value.notification)
  )
    return false;

  return true;
}

export function isStoredConfigEnvelope(value: unknown): value is RuntimeConfigEnvelope {
  if (!isConfigRecord(value)) return false;

  return 'config' in value && isValidRuntimeConfig(value.config);
}

export function parseRuntimeConfig(value: unknown): RuntimeConfig | null {
  if (isStoredConfigEnvelope(value)) return value.config;
  if (isValidRuntimeConfig(value)) return value;
  return null;
}

export async function loadRuntimeConfig(kv: KvStore): Promise<RuntimeConfig | null> {
  try {
    const data = await kv.get(KV_KEYS.CONFIG, { type: 'json' });
    if (!data) return null;

    const config = parseRuntimeConfig(data);
    if (config) return config;

    console.error('[Config] Invalid runtime config format');
    return null;
  } catch (error) {
    console.error('[Config] Failed to load runtime config:', error);
    return null;
  }
}

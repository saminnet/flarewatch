import type {
  RuntimeConfig,
  StoredConfig,
  Monitor,
  StatusPageConfig,
  DeploymentMeta,
  NotificationConfig,
  Webhook,
  Maintenance,
  KvStore,
} from './types';
import { KV_KEYS } from './types';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const WEBHOOK_TEMPLATES = new Set(['slack', 'discord', 'telegram', 'text']);
const WEBHOOK_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH']);
const WEBHOOK_PAYLOAD_TYPES = new Set(['param', 'json', 'x-www-form-urlencoded']);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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
  const obj = asRecord(value);
  if (!obj) return false;
  return Object.values(obj).every(
    (entry) => typeof entry === 'string' || typeof entry === 'number',
  );
}

function isValidWebhook(value: unknown): value is Webhook {
  const obj = asRecord(value);
  if (!obj) return false;

  if (typeof obj.url !== 'string' || !isValidHttpUrl(obj.url)) return false;
  if (obj.template !== undefined) {
    if (typeof obj.template !== 'string' || !WEBHOOK_TEMPLATES.has(obj.template)) return false;
  }
  if (obj.method !== undefined) {
    if (typeof obj.method !== 'string' || !WEBHOOK_METHODS.has(obj.method.toUpperCase()))
      return false;
  }
  if (obj.headers !== undefined && !isValidWebhookHeaders(obj.headers)) return false;
  if (obj.payloadType !== undefined) {
    if (typeof obj.payloadType !== 'string' || !WEBHOOK_PAYLOAD_TYPES.has(obj.payloadType))
      return false;
  }
  if (obj.timeout !== undefined && typeof obj.timeout !== 'number') return false;

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
  const obj = asRecord(value);
  if (!obj) return false;

  if (typeof obj.id !== 'string' || obj.id.length === 0) return false;
  if (typeof obj.body !== 'string' || obj.body.length === 0) return false;
  if (typeof obj.createdAt !== 'number' || !Number.isFinite(obj.createdAt)) return false;
  if (typeof obj.updatedAt !== 'number' || !Number.isFinite(obj.updatedAt)) return false;
  if (!(typeof obj.start === 'string' || typeof obj.start === 'number')) return false;
  if (obj.end !== undefined && !(typeof obj.end === 'string' || typeof obj.end === 'number')) {
    return false;
  }
  if (!isOptionalType(obj.title, isString)) return false;
  if (!isOptionalType(obj.color, isString)) return false;
  if (!isOptionalType(obj.monitors, isStringArray)) return false;

  return true;
}

export function parseMaintenances(value: unknown): Maintenance[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Maintenance => isValidMaintenance(item));
}

function isValidNotificationConfig(value: unknown): value is NotificationConfig {
  const obj = asRecord(value);
  if (!obj) return false;

  if (obj.webhook !== undefined) {
    const webhooks = Array.isArray(obj.webhook) ? obj.webhook : [obj.webhook];
    if (!webhooks.every(isValidWebhook)) return false;
  }

  if (!isOptionalType(obj.timeZone, isString)) return false;
  if (!isOptionalType(obj.gracePeriod, isNumber)) return false;
  if (!isOptionalType(obj.skipNotificationIds, isStringArray)) return false;
  if (!isOptionalType(obj.skipErrorChangeNotification, isBoolean)) return false;

  return true;
}

function isValidMonitor(value: unknown): value is Monitor {
  const obj = asRecord(value);
  if (!obj) return false;

  return (
    typeof obj.id === 'string' &&
    obj.id.length > 0 &&
    typeof obj.name === 'string' &&
    obj.name.length > 0 &&
    typeof obj.method === 'string' &&
    typeof obj.target === 'string' &&
    isValidMonitorTarget(obj.target, obj.method)
  );
}

function isValidStatusPageConfig(value: unknown): value is StatusPageConfig {
  const obj = asRecord(value);
  if (!obj) return false;
  return isOptionalType(obj.title, isString);
}

function isValidRuntimeConfig(value: unknown): value is RuntimeConfig {
  const obj = asRecord(value);
  if (!obj) return false;

  if (!Array.isArray(obj.monitors)) return false;
  if (!obj.monitors.every(isValidMonitor)) return false;
  if (obj.statusPage !== undefined && !isValidStatusPageConfig(obj.statusPage)) return false;
  if (obj.notification !== undefined && !isValidNotificationConfig(obj.notification)) return false;

  return true;
}

function isValidDeploymentMeta(value: unknown): value is DeploymentMeta {
  const obj = asRecord(value);
  if (!obj) return false;

  return (
    typeof obj.accountId === 'string' &&
    typeof obj.configKvNamespaceId === 'string' &&
    typeof obj.stateKvNamespaceId === 'string' &&
    typeof obj.monitorWorkerName === 'string' &&
    typeof obj.statusPageWorkerName === 'string'
  );
}

function isValidStoredConfig(value: unknown): value is StoredConfig {
  const obj = asRecord(value);
  if (!obj) return false;

  if (!isValidRuntimeConfig(obj.config)) return false;
  if (obj._deployment !== undefined && !isValidDeploymentMeta(obj._deployment)) return false;

  return true;
}

export async function loadRuntimeConfig(kv: KvStore): Promise<RuntimeConfig | null> {
  try {
    const data = await kv.get(KV_KEYS.CONFIG, { type: 'json' });
    if (!data) return null;

    if (isValidStoredConfig(data)) return data.config;
    if (isValidRuntimeConfig(data)) return data;

    console.error('[Config] Invalid runtime config format');
    return null;
  } catch (error) {
    console.error('[Config] Failed to load runtime config:', error);
    return null;
  }
}

import type {
  RuntimeConfig,
  StoredConfig,
  Monitor,
  StatusPageConfig,
  DeploymentMeta,
  NotificationConfig,
  Webhook,
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

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export const isValidWebhookUrl = isValidHttpUrl;

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

export function isValidMonitorTarget(target: string, method?: string): boolean {
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

export function isValidWebhook(value: unknown): value is Webhook {
  const obj = asRecord(value);
  if (!obj) return false;

  if (typeof obj.url !== 'string' || !isValidWebhookUrl(obj.url)) return false;
  if (obj.template !== undefined && !WEBHOOK_TEMPLATES.has(String(obj.template))) return false;
  if (obj.method !== undefined && !WEBHOOK_METHODS.has(String(obj.method).toUpperCase()))
    return false;
  if (obj.headers !== undefined && !isValidWebhookHeaders(obj.headers)) return false;
  if (obj.payloadType !== undefined && !WEBHOOK_PAYLOAD_TYPES.has(String(obj.payloadType)))
    return false;
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

export function isValidNotificationConfig(value: unknown): value is NotificationConfig {
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

export function isValidMonitor(value: unknown): value is Monitor {
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

export function isValidStatusPageConfig(value: unknown): value is StatusPageConfig {
  const obj = asRecord(value);
  if (!obj) return false;
  return isOptionalType(obj.title, isString);
}

export function isValidRuntimeConfig(value: unknown): value is RuntimeConfig {
  const obj = asRecord(value);
  if (!obj) return false;

  if (!Array.isArray(obj.monitors)) return false;
  if (!obj.monitors.every(isValidMonitor)) return false;
  if (obj.statusPage !== undefined && !isValidStatusPageConfig(obj.statusPage)) return false;
  if (obj.notification !== undefined && !isValidNotificationConfig(obj.notification)) return false;

  return true;
}

export function isValidDeploymentMeta(value: unknown): value is DeploymentMeta {
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

export function isValidStoredConfig(value: unknown): value is StoredConfig {
  const obj = asRecord(value);
  if (!obj) return false;

  if (!isValidRuntimeConfig(obj.config)) return false;
  if (obj._deployment !== undefined && !isValidDeploymentMeta(obj._deployment)) return false;

  return true;
}

export interface KVStore {
  get(key: string, options?: { type?: 'json' | 'text' }): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

export async function loadStoredConfig(kv: KVStore): Promise<StoredConfig | null> {
  try {
    const data = await kv.get(KV_KEYS.CONFIG, { type: 'json' });
    if (!data) return null;

    if (!isValidStoredConfig(data)) {
      console.error('[Config] Invalid stored config format');
      return null;
    }

    return data;
  } catch (error) {
    console.error('[Config] Failed to load from KV:', error);
    return null;
  }
}

export async function loadRuntimeConfig(kv: KVStore): Promise<RuntimeConfig | null> {
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

export async function saveStoredConfig(kv: KVStore, stored: StoredConfig): Promise<void> {
  if (!isValidStoredConfig(stored)) {
    throw new Error('Invalid stored config');
  }
  await kv.put(KV_KEYS.CONFIG, JSON.stringify(stored));
}

export function createStoredConfig(
  config: RuntimeConfig,
  deployment: Omit<DeploymentMeta, 'createdAt' | 'updatedAt' | 'version'>,
  version: string = '1.0.0',
): StoredConfig {
  const now = new Date().toISOString();
  return {
    config,
    _deployment: {
      ...deployment,
      createdAt: now,
      updatedAt: now,
      version,
    },
  };
}

export function updateStoredConfig(
  existing: StoredConfig,
  newConfig: RuntimeConfig,
  version?: string,
): StoredConfig {
  if (!existing._deployment) {
    return { config: newConfig };
  }
  return {
    config: newConfig,
    _deployment: {
      ...existing._deployment,
      updatedAt: new Date().toISOString(),
      version: version ?? existing._deployment.version,
    },
  };
}

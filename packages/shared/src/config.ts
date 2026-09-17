import * as z from 'zod/mini';
import {
  KV_KEYS,
  type KvStore,
  type Maintenance,
  type MonitorState,
  type MonitorTarget,
  type NotificationConfig,
  type PageConfig,
  type RuntimeConfig,
  type RuntimeConfigEnvelope,
  type Webhook,
} from './types';
import { isJsonObject } from './utils';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

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

function isAllowedPayload(payloadType: string | undefined, payload: unknown): boolean {
  return (
    payloadType === undefined ||
    payloadType === 'json' ||
    payload === undefined ||
    payload === null ||
    isJsonObject(payload)
  );
}

function asTypeGuard<T>(schema: z.ZodMiniType<SchemaOutput<T>>): (value: unknown) => value is T {
  return (value): value is T => schema.safeParse(value).success;
}

type Prev = [never, 0, 1, 2, 3];

/**
 * zod types every optional key as `T | undefined`, which the exact-optional types in types.ts do
 * not. Loosening a target type this way keeps `z.ZodMiniType<SchemaOutput<T>>` a real constraint:
 * a schema that drops a field or changes its type stops compiling. The depth stops the recursion
 * short of the self-referential JsonValue, which TS cannot expand.
 */
type SchemaOutput<T, Depth extends number = 4> = Depth extends 0
  ? unknown
  : { [K in keyof T]: SchemaOutput<T[K], Prev[Depth]> | undefined };

const timestamp = z.union([z.string(), z.number()]);

const maintenanceSchema: z.ZodMiniType<SchemaOutput<Maintenance>> = z.object({
  id: z.string().check(z.minLength(1)),
  body: z.string().check(z.minLength(1)),
  createdAt: z.number(),
  updatedAt: z.number(),
  start: timestamp,
  end: z.optional(timestamp),
  title: z.optional(z.string()),
  color: z.optional(z.string()),
  monitors: z.optional(z.array(z.string())),
});

const monitorSchema: z.ZodMiniType<SchemaOutput<MonitorTarget>> = z
  .object({
    id: z.string().check(z.minLength(1)),
    name: z.string().check(z.minLength(1)),
    method: z.string(),
    target: z.string(),
  })
  .check(z.refine((monitor) => isValidMonitorTarget(monitor.target, monitor.method)));

const statusPageSchema: z.ZodMiniType<SchemaOutput<PageConfig>> = z.object({
  title: z.optional(z.string()),
});

const webhookMethod = z.pipe(
  z.string().check(z.toUpperCase()),
  z.enum(['GET', 'POST', 'PUT', 'PATCH']),
);

const webhookSchema: z.ZodMiniType<SchemaOutput<Webhook>> = z
  .object({
    url: z.string().check(z.refine(isValidHttpUrl)),
    template: z.optional(z.enum(['slack', 'discord', 'telegram', 'ntfy', 'text'])),
    method: z.optional(webhookMethod),
    headers: z.optional(z.record(z.string(), z.union([z.string(), z.number()]))),
    payloadType: z.optional(z.enum(['param', 'json', 'x-www-form-urlencoded'])),
    payload: z.optional(z.json()),
    timeout: z.optional(z.number()),
  })
  .check(z.refine((webhook) => isAllowedPayload(webhook.payloadType, webhook.payload)));

const notificationSchema: z.ZodMiniType<SchemaOutput<NotificationConfig>> = z.object({
  webhook: z.optional(z.union([webhookSchema, z.array(webhookSchema)])),
  timeZone: z.optional(z.string()),
  gracePeriod: z.optional(z.number()),
  skipNotificationIds: z.optional(z.array(z.string())),
  skipErrorChangeNotification: z.optional(z.boolean()),
});

const runtimeConfigSchema: z.ZodMiniType<SchemaOutput<RuntimeConfig>> = z.object({
  monitors: z.array(monitorSchema),
  statusPage: z.optional(statusPageSchema),
  notification: z.optional(notificationSchema),
});

const envelopeSchema: z.ZodMiniType<SchemaOutput<RuntimeConfigEnvelope>> = z.object({
  config: runtimeConfigSchema,
});

const monitorStateSchema: z.ZodMiniType<SchemaOutput<MonitorState>> = z.object({
  lastUpdate: z.number(),
  overallUp: z.number(),
  overallDown: z.number(),
  startedAt: z.record(z.string(), z.number()),
  incident: z.record(
    z.string(),
    z.array(
      z.object({
        start: z.array(z.number()),
        end: z.optional(z.number()),
        error: z.array(z.string()),
      }),
    ),
  ),
  latency: z.record(
    z.string(),
    z.object({
      recent: z.array(z.object({ loc: z.string(), ping: z.number(), time: z.number() })),
    }),
  ),
  sslCertificates: z.optional(
    z.record(
      z.string(),
      z.object({
        expiryDate: z.number(),
        daysUntilExpiry: z.number(),
        lastCheck: z.number(),
        issuer: z.optional(z.string()),
        subject: z.optional(z.string()),
      }),
    ),
  ),
});

export const isValidMaintenance = asTypeGuard<Maintenance>(maintenanceSchema);
export const isMonitorState = asTypeGuard<MonitorState>(monitorStateSchema);
export const isValidRuntimeConfig = asTypeGuard<RuntimeConfig>(runtimeConfigSchema);
export const isStoredConfigEnvelope = asTypeGuard<RuntimeConfigEnvelope>(envelopeSchema);

export function parseMaintenances(value: unknown): Maintenance[] {
  return Array.isArray(value) ? value.filter(isValidMaintenance) : [];
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

import * as z from 'zod/mini';
import {
  NOTIFICATION_TEMPLATES,
  type HeartbeatSignal,
  type Maintenance,
  type MonitorState,
  type NotificationConfig,
  type PageConfig,
  type RuntimeConfig,
  type Webhook,
} from './types';
import { isJsonObject, isNonEmptyString } from './utils';

const PULL_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'TCP_PING',
] as const;
const MONITOR_METHODS = new Set<string>([...PULL_METHODS, 'HEARTBEAT']);
const HEARTBEAT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_HEARTBEAT_PERIOD_SECONDS = 2_678_400;
const MAX_HEARTBEAT_GRACE_SECONDS = 604_800;

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

function targetIssue(method: string, target: string): string | null {
  if (method === 'TCP_PING') {
    return isValidHostPort(target)
      ? null
      : 'TCP_PING target must be host:port (e.g. "example.com:443")';
  }
  return isValidHttpUrl(target.trim()) ? null : `${method} target must be an http(s) URL`;
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

function nonEmptyString(field: string) {
  const error = `${field} must be a non-empty string`;
  return z.string({ error }).check(z.minLength(1, { error }));
}

function intInRange(field: string, min: number, max: number) {
  const error = `${field} must be an integer from ${min} to ${max}`;
  return z.int({ error }).check(z.gte(min, { error }), z.lte(max, { error }));
}

const monitorCommon = {
  id: nonEmptyString('id'),
  name: nonEmptyString('name'),
  private: z.optional(z.boolean({ error: 'private must be a boolean' })),
};

const pullMonitorSchema = z
  .looseObject({
    ...monitorCommon,
    method: z.enum(PULL_METHODS),
    target: z.string({ error: 'target must be a string' }),
  })
  .check((ctx) => {
    const issue = targetIssue(ctx.value.method, ctx.value.target);
    if (issue) ctx.issues.push({ code: 'custom', message: issue, input: ctx.value });
  });

const heartbeatMonitorSchema = z.looseObject({
  ...monitorCommon,
  id: z
    .string()
    .check(z.regex(HEARTBEAT_ID, { error: 'HEARTBEAT id must match ^[A-Za-z0-9_-]{1,64}$' })),
  method: z.literal('HEARTBEAT'),
  periodSeconds: intInRange('periodSeconds', 60, MAX_HEARTBEAT_PERIOD_SECONDS),
  graceSeconds: intInRange('graceSeconds', 0, MAX_HEARTBEAT_GRACE_SECONDS),
  target: z.optional(z.never({ error: 'HEARTBEAT must not define target' })),
  checkProxy: z.optional(z.never({ error: 'HEARTBEAT must not define checkProxy' })),
});

function methodIssue(method: unknown): string {
  const upper = typeof method === 'string' ? method.toUpperCase() : undefined;
  return upper !== undefined && upper !== method && MONITOR_METHODS.has(upper)
    ? `method must be uppercase: "${upper}"`
    : `unknown method ${JSON.stringify(method)}`;
}

const monitorSchema = z.pipe(
  z.looseObject(
    { method: z.string({ error: 'method must be a string' }) },
    { error: 'entry must be an object' },
  ),
  z.discriminatedUnion('method', [pullMonitorSchema, heartbeatMonitorSchema], {
    error: (issue) =>
      issue.code === 'invalid_union' && isJsonObject(issue.input)
        ? methodIssue(issue.input.method)
        : undefined,
  }),
);

const monitorListSchema = z.array(monitorSchema).check((ctx) => {
  const ids = new Set<string>();
  ctx.value.forEach((monitor, index) => {
    if (ids.has(monitor.id)) {
      ctx.issues.push({
        code: 'custom',
        message: 'id must be unique',
        input: monitor,
        path: [index],
      });
    }
    ids.add(monitor.id);
  });
});

const statusPageSchema: z.ZodMiniType<SchemaOutput<PageConfig>> = z.object({
  title: z.optional(z.string()),
  visibility: z.optional(z.enum(['public', 'private'])),
});

const webhookMethod = z.pipe(
  z.string().check(z.toUpperCase()),
  z.enum(['GET', 'POST', 'PUT', 'PATCH']),
);

const webhookSchema: z.ZodMiniType<SchemaOutput<Webhook>> = z
  .object({
    url: z.string().check(z.refine(isValidHttpUrl)),
    template: z.optional(z.enum(NOTIFICATION_TEMPLATES)),
    options: z.optional(z.record(z.string(), z.string())),
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
  monitors: monitorListSchema,
  statusPage: z.optional(statusPageSchema),
  notification: z.optional(notificationSchema),
});

const heartbeatRunSchema = z.object({
  at: z.number(),
  outcome: z.enum(['ok', 'late', 'fail', 'miss']),
  startedAt: z.exactOptional(z.number()),
});

const heartbeatSignalShape = {
  lastSuccess: z.exactOptional(z.number()),
  lastFail: z.exactOptional(z.number()),
  lastStart: z.exactOptional(z.number()),
  message: z.exactOptional(z.string()),
  runs: z.exactOptional(z.array(heartbeatRunSchema)),
};

const heartbeatSignalSchema = z.object(heartbeatSignalShape);

const heartbeatStateSchema = z.object({
  ...heartbeatSignalShape,
  status: z.enum(['up', 'late', 'pending', 'running', 'down']),
  deadline: z.exactOptional(z.number()),
  misses: z.exactOptional(z.array(z.number())),
});

const monitorStateSchema: z.ZodMiniType<SchemaOutput<MonitorState>> = z.object({
  lastUpdate: z.number(),
  overallUp: z.number(),
  overallDown: z.number(),
  overallLate: z.optional(z.number()),
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
  heartbeat: z.optional(z.record(z.string(), heartbeatStateSchema)),
});

export const isValidMaintenance = asTypeGuard<Maintenance>(maintenanceSchema);
export const isMonitorState = asTypeGuard<MonitorState>(monitorStateSchema);

/** Why a config is invalid, one line per problem. Empty when the config is valid. */
export function configIssues(value: unknown): string[] {
  const result = runtimeConfigSchema.safeParse(value);
  if (result.success) return [];

  const monitors = isJsonObject(value) && Array.isArray(value.monitors) ? value.monitors : [];
  return result.error.issues.map(({ path, message }) => {
    const [first, index] = path;
    const monitor: unknown = first === 'monitors' ? monitors[Number(index)] : undefined;
    if (monitor === undefined) return `${path.map(String).join('.') || 'config'}: ${message}`;
    const id =
      isJsonObject(monitor) && isNonEmptyString(monitor.id) ? monitor.id : `#${String(index)}`;
    return `monitor "${id}": ${message}`;
  });
}

/** Returns only the known signal fields, so a foreign key in storage cannot override derived state. */
export function parseHeartbeatSignal(value: unknown): HeartbeatSignal | null {
  const result = heartbeatSignalSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseMaintenances(value: unknown): Maintenance[] {
  return Array.isArray(value) ? value.filter(isValidMaintenance) : [];
}

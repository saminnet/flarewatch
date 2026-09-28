import * as z from 'zod/mini';
import {
  NOTIFICATION_TEMPLATES,
  type AccessConfig,
  type HeartbeatSignal,
  type HeartbeatState,
  type LatencySample,
  type Maintenance,
  type MonitorState,
  type NotificationConfig,
  type PageConfig,
  type RuntimeConfig,
  type HubView,
  type Webhook,
} from './types';
import { isJsonObject, isNonEmptyString, isSecureUrl } from './utils';

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
  dependsOn: z.optional(z.array(z.string(), { error: 'dependsOn must be a list of monitor ids' })),
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
  const byId = new Map(ctx.value.map((monitor) => [monitor.id, monitor]));
  ctx.value.forEach((monitor, index) => {
    for (const message of dependencyIssues(monitor, byId)) {
      ctx.issues.push({ code: 'custom', message, input: monitor, path: [index] });
    }
  });
});

type DependencyNode = { id: string; dependsOn?: string[] | undefined };

function dependencyIssues(monitor: DependencyNode, byId: Map<string, DependencyNode>): string[] {
  const dependsOn = monitor.dependsOn ?? [];
  const issues: string[] = [];
  dependsOn.forEach((id, index) => {
    if (id === monitor.id) issues.push('dependsOn cannot list the monitor itself');
    else if (!byId.has(id)) issues.push(`dependsOn: no monitor has id "${id}"`);
    else if (dependsOn.indexOf(id) !== index) issues.push(`dependsOn lists "${id}" twice`);
  });
  const loop = loopFrom(monitor.id, byId);
  if (loop) issues.push(`dependsOn forms a loop: ${loop.join(' → ')}`);
  return issues;
}

/** A dependency path from `start` back to itself, if there is one. */
function loopFrom(start: string, byId: Map<string, DependencyNode>): string[] | null {
  const seen = new Set<string>();
  const walk = (id: string, path: string[]): string[] | null => {
    for (const next of byId.get(id)?.dependsOn ?? []) {
      if (next === start) {
        if (path.length > 1) return [...path, start];
        continue;
      }
      if (seen.has(next) || !byId.has(next)) continue;
      seen.add(next);
      const loop = walk(next, [...path, next]);
      if (loop) return loop;
    }
    return null;
  };
  return walk(start, [start]);
}

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

const PROVIDER_ID = /^[A-Za-z0-9_-]{1,32}$/;
const ACCESS_RULE = /^(\*@[^@\s]+|[^@\s*]+@[^@\s]+|group:\S+|github:[A-Za-z0-9-]+)$/;

const providerId = z
  .string()
  .check(z.regex(PROVIDER_ID, { error: 'provider id must match ^[A-Za-z0-9_-]{1,32}$' }));
const accessRules = z.array(
  z.string().check(
    z.regex(ACCESS_RULE, {
      error: 'access rules are an email, *@domain, group:<name> or github:<login>',
    }),
  ),
);

const accessConfigSchema: z.ZodMiniType<SchemaOutput<AccessConfig>> = z
  .object({
    providers: z.optional(
      z.array(
        z.union([
          z.object({
            id: providerId,
            name: nonEmptyString('provider name'),
            type: z.literal('github'),
            clientId: nonEmptyString('clientId'),
          }),
          z.object({
            id: providerId,
            name: nonEmptyString('provider name'),
            type: z.optional(z.literal('oidc')),
            issuer: z.string().check(
              z.refine(isSecureUrl, {
                error: 'issuer must be an https URL (http only on localhost)',
              }),
            ),
            clientId: nonEmptyString('clientId'),
          }),
        ]),
      ),
    ),
    operators: z.optional(accessRules),
    members: z.optional(accessRules),
    audiences: z.optional(
      z.record(z.string(), z.object({ members: accessRules, groups: z.array(z.string()) })),
    ),
  })
  .check(
    z.refine(
      (access) => {
        const ids = (access.providers ?? []).map((provider) => provider.id.toLowerCase());
        return new Set(ids).size === ids.length;
      },
      { error: 'provider ids must be unique' },
    ),
  );

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

const incidentSchema = z.object({
  start: z.array(z.number()),
  end: z.exactOptional(z.number()),
  error: z.array(z.string()),
});

const latencySampleSchema = z.object({ loc: z.string(), ping: z.number(), time: z.number() });

const monitorStateSchema: z.ZodMiniType<SchemaOutput<MonitorState>> = z.object({
  lastUpdate: z.number(),
  overallUp: z.number(),
  overallDown: z.number(),
  overallLate: z.optional(z.number()),
  startedAt: z.record(z.string(), z.number()),
  incident: z.record(z.string(), z.array(incidentSchema)),
  latency: z.record(z.string(), z.object({ recent: z.array(latencySampleSchema) })),
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

const hubViewSchema: z.ZodMiniType<SchemaOutput<HubView>> = z.object({
  lastUpdate: z.number(),
  maintenances: z.array(maintenanceSchema),
  monitors: z.record(
    z.string(),
    z.object({
      status: z.enum(['up', 'late', 'pending', 'running', 'down']),
      startedAt: z.exactOptional(z.number()),
      incidents: z.array(incidentSchema),
      latest: z.exactOptional(latencySampleSchema),
      heartbeat: z.exactOptional(heartbeatStateSchema),
    }),
  ),
});

export const isValidMaintenance = asTypeGuard<Maintenance>(maintenanceSchema);
export const isMonitorState = asTypeGuard<MonitorState>(monitorStateSchema);

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

/**
 * The webhooks in the FLAREWATCH_WEBHOOKS secret, one or a list as in `notification.webhook`.
 * A bad entry is dropped with an issue; the others still alert. Issues never quote the secret.
 */
export function parseSecretWebhooks(text: string) {
  const webhooks: Webhook[] = [];
  const issues: string[] = [];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    issues.push('not valid JSON');
    return { webhooks, issues };
  }
  const entries: unknown[] = Array.isArray(value) ? value : [value];
  entries.forEach((entry, index) => {
    const result = webhookSchema.safeParse(entry);
    // The parsed value, not the entry: parsing upper-cases the method.
    if (result.success && isWebhook(result.data)) webhooks.push(result.data);
    for (const { path, message } of result.error?.issues ?? []) {
      // The top field only: a deeper key sits inside headers or options and could be a token.
      issues.push(
        `webhook ${index + 1}${path.length > 0 ? `.${String(path[0])}` : ''}: ${message}`,
      );
    }
  });
  return { webhooks, issues };
}

export function accessConfigIssues(value: unknown, pageGroups: string[]): string[] {
  const result = accessConfigSchema.safeParse(value);
  if (!result.success) {
    return result.error.issues.map(
      ({ path, message }) => `${['access', ...path.map(String)].join('.')}: ${message}`,
    );
  }
  if (!isAccessConfig(value)) return [];
  // An audience whose groups are not on the page would sign in to an empty page.
  return Object.entries(value.audiences ?? {}).flatMap(([name, audience]) =>
    audience.groups
      .filter((group) => !pageGroups.includes(group))
      .map((group) => `access.audiences.${name}: no page group is named "${group}"`),
  );
}

/** Returns only the known signal fields, so a foreign key in storage cannot override derived state. */
export function parseHeartbeatSignal(value: unknown): HeartbeatSignal | null {
  const result = heartbeatSignalSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseHeartbeatState(value: unknown): HeartbeatState | null {
  const result = heartbeatStateSchema.safeParse(value);
  return result.success ? result.data : null;
}

export const isHubView = asTypeGuard<HubView>(hubViewSchema);
const isAccessConfig = asTypeGuard<AccessConfig>(accessConfigSchema);
const isWebhook = asTypeGuard<Webhook>(webhookSchema);
export const isLatencySamples = asTypeGuard<LatencySample[]>(z.array(latencySampleSchema));

export function parseMaintenances(value: unknown): Maintenance[] {
  return Array.isArray(value) ? value.filter(isValidMaintenance) : [];
}

export type PageConfig = {
  title?: string;
  links?: PageConfigLink[];
  group?: PageConfigGroup;
  favicon?: string;
  logo?: string;
  apiCorsOrigins?: string[];
  /** 'private' shows visitors only the sign-in page. Defaults to 'public'. */
  visibility?: 'public' | 'private';
};

export type PageConfigGroup = { [key: string]: string[] };

/** A sign-in provider. OpenID Connect by default; GitHub has its own flow. */
export type AuthProvider =
  | {
      /** Letters, digits, `-` and `_`. Keys the client secret in FLAREWATCH_OIDC_SECRETS. */
      id: string;
      name: string;
      type?: 'oidc';
      /** The issuer URL; its /.well-known/openid-configuration is read at sign-in. */
      issuer: string;
      clientId: string;
    }
  | { id: string; name: string; type: 'github'; clientId: string };

/**
 * Who may sign in and what they see. A rule is an email (`me@example.com`), a
 * domain (`*@example.com`), a group claim (`group:admins`) or a GitHub login
 * (`github:octocat`).
 */
export type AccessConfig = {
  providers?: AuthProvider[];
  /** Everything, including maintenance editing and ping URLs. */
  operators?: string[];
  /** Every monitor, private ones included, read only. */
  members?: string[];
  /** Published monitors plus the monitors in these page groups. */
  audiences?: Record<string, { members: string[]; groups: string[] }>;
};

type PageConfigLink = {
  link: string;
  label: string;
  highlight?: boolean;
};

/**
 * Repeats the window from its start and end, which must be at most 24 hours apart. Each run
 * starts at the start's wall-clock time in `timeZone`.
 */
export type MaintenanceRepeat = {
  every: 'day' | 'week' | 'month';
  /** Weekly only: 0 is Sunday. Defaults to the start's weekday. */
  weekdays?: number[];
  /** Monthly only: 1 to 31. Defaults to the start's day; months without that day are skipped. */
  dayOfMonth?: number;
  /** No run starts after this. Without it the window repeats for good. */
  until?: number | string;
  /** An IANA time zone, like Europe/Berlin. Defaults to UTC. */
  timeZone?: string;
};

export type MaintenanceConfig = {
  monitors?: string[];
  title?: string;
  body: string;
  start: number | string;
  end?: number | string;
  color?: string;
  repeat?: MaintenanceRepeat;
};

export type Maintenance = MaintenanceConfig & {
  id: string;
  /** Unix timestamp (ms) */
  createdAt: number;
  /** Unix timestamp (ms) */
  updatedAt: number;
};

export type PullMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | 'TCP_PING';

export type PullMonitor = {
  id: string;
  name: string;
  method: PullMethod;
  target: string;
  tooltip?: string;
  /**
   * Clickable link on the monitor name: auto-links to `target` if HTTP/HTTPS
   * (default), a URL string overrides it, `false` disables it.
   */
  link?: string | false;
  hideLatencyChart?: boolean;
  /** Shows the monitor as degraded while its latest response took longer than this many milliseconds. Never alerts. */
  maxLatencyMs?: number;
  expectedCodes?: number[];
  timeout?: number;
  headers?: { [key: string]: string | number };
  body?: string;
  responseKeyword?: string;
  responseForbiddenKeyword?: string;
  /** A path like `$.a.b[0].c` into the JSON body; the value there must equal `responseJsonValue`. */
  responseJsonPath?: string;
  responseJsonValue?: string | number | boolean | null;
  /** Response headers that must be present with exactly these values. Names ignore case. */
  responseHeaderEquals?: Record<string, string>;
  checkProxy?: string;
  checkProxyFallback?: boolean;
  /**
   * Another place to check from, in `checkProxy`'s formats. When the check fails, it runs once
   * more from here, and this result is the one recorded.
   */
  confirmVia?: string;
  pingProtocol?: 'tcp' | 'icmp';
  sslCheckEnabled?: boolean;
  sslCheckDaysBeforeExpiry?: number;
  sslIgnoreSelfSigned?: boolean;
  /**
   * Hide from the status page and public API. The monitor is still checked,
   * stored, and alerted, only signed-in admins see it.
   */
  private?: boolean;
  /** Monitor ids this one reaches its target through. While one of them is down, this one sends no alert of its own. */
  dependsOn?: string[];
  /** Check runs between reminders while the monitor stays down after its down alert, at least 30. Off when absent. */
  reminderEveryChecks?: number;
};

export type HeartbeatMonitor = {
  id: string;
  name: string;
  method: 'HEARTBEAT';
  periodSeconds: number;
  graceSeconds: number;
  private?: boolean;
  dependsOn?: string[];
  /** Check runs between reminders while the job stays down after its down alert, at least 30. Off when absent. */
  reminderEveryChecks?: number;
  link?: string | false;
  tooltip?: string;
};

export type Monitor = PullMonitor | HeartbeatMonitor;

export type MonitorTarget = PullMonitor;

export function isPublicMonitor(monitor: Pick<MonitorTarget, 'private'>): boolean {
  return monitor.private !== true;
}

export type WorkerConfig = {
  monitors: Monitor[];
  notification?: NotificationConfig;
  callbacks?: {
    onStatusChange?: (
      env: unknown,
      monitor: Monitor,
      isUp: boolean,
      timeIncidentStart: number,
      timeNow: number,
      reason: string,
    ) => Promise<void>;
    onIncident?: (
      env: unknown,
      monitor: Monitor,
      timeIncidentStart: number,
      timeNow: number,
      reason: string,
    ) => Promise<void>;
  };
};

export type NotificationConfig = {
  webhook?: WebhookConfig;
  timeZone?: string;
  gracePeriod?: number;
  skipNotificationIds?: string[];
  skipErrorChangeNotification?: boolean;
};

export const NOTIFICATION_TEMPLATES = [
  'slack',
  'discord',
  'telegram',
  'ntfy',
  'text',
  'teams',
  'googlechat',
  'matrix',
  'pushover',
  'gotify',
  'zulip',
  'resend',
  'mattermost',
  'rocketchat',
] as const;

export type NotificationTemplate = (typeof NOTIFICATION_TEMPLATES)[number];

/** A JSON object: every value that survives `JSON.parse` on an object payload. */
export type JsonObject = { [key: string]: JsonValue };

/** Any value representable as JSON: the contract for user-authored webhook payloads. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

type SingleWebhook = {
  url: string;
  /** Use a pre-built template (see NOTIFICATION_TEMPLATES) */
  template?: NotificationTemplate;
  /** Extra string settings a template needs (e.g. resend from/to, pushover token/user) */
  options?: Record<string, string>;
  /** HTTP method (default: from the template, POST for custom payloads) */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  headers?: { [key: string]: string | number };
  /** Payload type (required if not using template) */
  payloadType?: 'param' | 'json' | 'x-www-form-urlencoded';
  /** Payload with $MSG placeholder (required if not using template) */
  payload?: JsonValue;
  /** Request timeout in ms (default: 5000) */
  timeout?: number;
  /** IDs of the monitors whose alerts this webhook gets. Absent means every monitor; an empty list, none. */
  monitors?: string[];
};

export type Webhook = SingleWebhook;

export type WebhookConfig = SingleWebhook | SingleWebhook[];

export type RuntimeConfig = {
  monitors: Monitor[];
  statusPage?: PageConfig;
  notification?: NotificationConfig;
};

export type HeartbeatRun = {
  /** Unix timestamp (seconds) */
  at: number;
  outcome: 'ok' | 'late' | 'fail' | 'miss';
  startedAt?: number;
};

/** Cap on the per-monitor run history kept in the heartbeat signal. */
export const HEARTBEAT_RUN_HISTORY = 90;

export type HeartbeatSignal = {
  lastSuccess?: number;
  lastFail?: number;
  lastStart?: number;
  message?: string;
  /** Recent run outcomes, oldest first, capped at HEARTBEAT_RUN_HISTORY. */
  runs?: HeartbeatRun[];
};

export type HeartbeatStatus = 'up' | 'late' | 'pending' | 'running' | 'down';

export type HeartbeatState = HeartbeatSignal & {
  status: HeartbeatStatus;
  deadline?: number;
  /** Deadline timestamps the cron detected as missed, oldest first, capped at HEARTBEAT_RUN_HISTORY. */
  misses?: number[];
};

/** A stretch of downtime. Each error change inside it starts a new segment. */
export type Incident = {
  /** Unix timestamps (seconds). One per error segment. */
  start: number[];
  /** Unix timestamp (seconds). Undefined while the incident is open. */
  end?: number;
  error: string[];
};

export type LatencySample = {
  loc: string;
  ping: number;
  /** Unix timestamp (seconds) */
  time: number;
};

/** One monitor as the hub knows it. Down means an open incident. */
export type MonitorView = {
  status: HeartbeatStatus;
  /** Unix timestamp (seconds) of the first check result. */
  startedAt?: number;
  /** Oldest first, kept 90 days after they end. */
  incidents: Incident[];
  latest?: LatencySample;
  heartbeat?: HeartbeatState;
};

export type StatusView = {
  /** Unix timestamp (seconds) of the last check run; 0 before the first. */
  lastUpdate: number;
  monitors: Record<string, MonitorView>;
};

/** What the status page reads from the hub in one call. */
export type HubView = StatusView & { maintenances: Maintenance[] };

export interface SSLCertificateInfo {
  /** Unix timestamp (seconds) */
  expiryDate: number;
  daysUntilExpiry: number;
  issuer?: string;
  subject?: string;
}

export interface CheckSuccess {
  ok: true;
  latency: number;
  ssl?: SSLCertificateInfo;
}

export interface CheckFailure {
  ok: false;
  error: string;
  latency?: number;
}

export type CheckResult = CheckSuccess | CheckFailure;

export interface CheckResultWithLocation {
  location: string;
  result: CheckResult;
}

/** What one check run can still spend. Every monitor in the run shares one. */
export interface RunBudget {
  /** Unix timestamp (ms) by which every check has ended. */
  deadline: number;
  /** Subrequests left for extra attempts: a fallback or a confirmation. Spent as each starts. */
  subrequests: number;
}

export interface CheckContext {
  /**
   * Worker bindings a checker may need. Kept structural and narrow so shared
   * does not depend on the worker's Env type.
   */
  env: { FLAREWATCH_PROXY_TOKEN?: string };
  budget: RunBudget;
}

export interface MonitorChecker {
  check(target: MonitorTarget): Promise<CheckResult>;
}

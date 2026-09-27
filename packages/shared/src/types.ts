export type PageConfig = {
  title?: string;
  links?: PageConfigLink[];
  group?: PageConfigGroup;
  favicon?: string;
  logo?: string;
  apiCorsOrigins?: string[];
  poweredByUrl?: string;
  theme?: string;
  customCss?: string;
  themeVars?: string;
  /** 'private' shows visitors only the sign-in page. Defaults to 'public'. */
  visibility?: 'public' | 'private';
};

export type PageConfigGroup = { [key: string]: string[] };

type PageConfigLink = {
  link: string;
  label: string;
  highlight?: boolean;
};

export type MaintenanceConfig = {
  monitors?: string[];
  title?: string;
  body: string;
  start: number | string;
  end?: number | string;
  color?: string;
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
   * Controls the clickable link on the monitor name.
   * - undefined: auto-link to `target` if HTTP/HTTPS (default)
   * - string: use this URL instead (e.g., a status page)
   * - false: disable the link (for internal services)
   */
  link?: string | false;
  hideLatencyChart?: boolean;
  expectedCodes?: number[];
  timeout?: number;
  headers?: { [key: string]: string | number };
  body?: string;
  responseKeyword?: string;
  responseForbiddenKeyword?: string;
  checkProxy?: string;
  checkProxyFallback?: boolean;
  pingProtocol?: 'tcp' | 'icmp';
  sslCheckEnabled?: boolean;
  sslCheckDaysBeforeExpiry?: number;
  sslIgnoreSelfSigned?: boolean;
  /**
   * Hide from the status page and public API. The monitor is still checked,
   * stored, and alerted, only signed-in admins see it.
   */
  private?: boolean;
};

export type HeartbeatMonitor = {
  id: string;
  name: string;
  method: 'HEARTBEAT';
  periodSeconds: number;
  graceSeconds: number;
  private?: boolean;
  link?: string | false;
  tooltip?: string;
};

export type Monitor = PullMonitor | HeartbeatMonitor;

export type MonitorTarget = PullMonitor;

export function isPublicMonitor(monitor: Pick<MonitorTarget, 'private'>): boolean {
  return monitor.private !== true;
}

export type WorkerConfig = {
  kvWriteCooldownMinutes?: number;
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
};

export type Webhook = SingleWebhook;

export type WebhookConfig = SingleWebhook | SingleWebhook[];

export type RuntimeConfig = {
  monitors: Monitor[];
  statusPage?: PageConfig;
  notification?: NotificationConfig;
  kvWriteCooldownMinutes?: number;
};

export interface KvStore {
  get(key: string, options?: { type?: 'json' | 'text' }): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

export const KV_KEYS = {
  STATE: 'state',
  MAINTENANCES: 'maintenances',
} as const;

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

export function heartbeatKvKey(id: string): string {
  return `hb:v1:${id}`;
}

export type MonitorState = {
  /** Unix timestamp (seconds) */
  lastUpdate: number;
  overallUp: number;
  overallDown: number;
  overallLate?: number;
  /** Unix timestamp (seconds) of the first check per monitor */
  startedAt: Record<string, number>;
  incident: Record<
    string,
    {
      /** Unix timestamps (seconds). One per error segment. */
      start: number[];
      /** Unix timestamp (seconds). Undefined if it's still open. */
      end?: number | undefined;
      error: string[];
    }[]
  >;
  latency: Record<
    string,
    {
      recent: {
        loc: string;
        ping: number;
        /** Unix timestamp (seconds) */
        time: number;
      }[];
    }
  >;
  sslCertificates?: Record<
    string,
    {
      /** Unix timestamp (seconds) */
      expiryDate: number;
      daysUntilExpiry: number;
      issuer?: string;
      subject?: string;
      /** Unix timestamp (seconds) */
      lastCheck: number;
    }
  >;
  heartbeat?: Record<string, HeartbeatState>;
};

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
  heartbeat?: HeartbeatState;
}

export interface PendingHeartbeatCheckResult {
  location: string;
  result?: undefined;
  heartbeat: HeartbeatState;
}

export type MonitorCheckResult = CheckResultWithLocation | PendingHeartbeatCheckResult;

export interface CheckContext {
  /**
   * Worker bindings a checker may need. Kept structural and narrow so shared
   * does not depend on the worker's Env type.
   */
  env: { FLAREWATCH_PROXY_TOKEN?: string };
  /** Heartbeat signal storage, resolved once by the scheduler via getStateKv. */
  stateKv?: KvStore;
  /** Unix timestamp (seconds) for this check run; pull checkers ignore it. */
  now: number;
}

export interface MonitorChecker {
  check(target: MonitorTarget): Promise<CheckResult>;
}

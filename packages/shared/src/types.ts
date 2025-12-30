export type PageConfig = {
  title?: string;
  links?: PageConfigLink[];
  group?: PageConfigGroup;
  favicon?: string;
  logo?: string;
  /**
   * Allowed CORS origins for the public API endpoints (for example `/api/data`).
   *
   * If omitted, the API responds with `Access-Control-Allow-Origin: *` to make
   * embedding and integrations easy by default.
   */
  apiCorsOrigins?: string[];
  customFooter?: string;
};

export type PageConfigGroup = { [key: string]: string[] };

export type PageConfigLink = {
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

export type MonitorTarget = {
  id: string;
  name: string;
  method: string;
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
};

export type WorkerConfig = {
  kvWriteCooldownMinutes?: number;
  monitors: MonitorTarget[];
  notification?: Notification;
  callbacks?: {
    onStatusChange?: (
      env: unknown,
      monitor: MonitorTarget,
      isUp: boolean,
      timeIncidentStart: number,
      timeNow: number,
      reason: string,
    ) => Promise<void>;
    onIncident?: (
      env: unknown,
      monitor: MonitorTarget,
      timeIncidentStart: number,
      timeNow: number,
      reason: string,
    ) => Promise<void>;
  };
};

export type Notification = {
  webhook?: WebhookConfig;
  timeZone?: string;
  gracePeriod?: number;
  skipNotificationIds?: string[];
  skipErrorChangeNotification?: boolean;
};

export type NotificationTemplate = 'slack' | 'discord' | 'telegram' | 'text';

type SingleWebhook = {
  url: string;
  /** Use a pre-built template (slack, discord, telegram, text) */
  template?: NotificationTemplate;
  /** HTTP method (default: POST for templates, depends on payloadType otherwise) */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  /** Custom headers */
  headers?: { [key: string]: string | number };
  /** Payload type (required if not using template) */
  payloadType?: 'param' | 'json' | 'x-www-form-urlencoded';
  /** Payload with $MSG placeholder (required if not using template) */
  payload?: unknown;
  /** Request timeout in ms (default: 5000) */
  timeout?: number;
};

export type WebhookConfig = SingleWebhook | SingleWebhook[];

export type MonitorState = {
  /** Unix timestamp (seconds) */
  lastUpdate: number;
  overallUp: number;
  overallDown: number;
  /** Unix timestamp (seconds) of the first check per monitor */
  startedAt: Record<string, number>;
  incident: Record<
    string,
    {
      /** Unix timestamps (seconds). One per error segment. */
      start: number[];
      /** Unix timestamp (seconds). Undefined if it's still open. */
      end: number | undefined;
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
}

export interface MonitorChecker {
  check(target: MonitorTarget): Promise<CheckResult>;
}

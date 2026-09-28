export interface TemplateContext {
  monitorName: string;
  monitorId: string;
  targetUrl: string;
  isUp: boolean;
  isRecovery: boolean;
  isInitialOutage: boolean;
  downtimeMinutes: number;
  reason: string;
  /** Monitors behind this one that are down with it; their own alerts are held back. */
  alsoDown: string[];
  timestamp: string;
  timestampIso: string;
  /** Stable id for one incident, identical across its down and up notifications */
  incidentKey: string;
  /** URL configured on the webhook entry (matrix splices its txn id into it) */
  webhookUrl: string;
  /** Extra per-entry settings (pushover token/user, resend from/to, zulip to/topic) */
  options: Record<string, string>;
}

export interface TemplateOutput {
  method: 'GET' | 'POST' | 'PUT';
  /** Override the configured URL (defaults to the webhook entry's url) */
  url?: string;
  headers: Record<string, string>;
  body: string;
}

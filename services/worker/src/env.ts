import type { MonitorHub } from './hub/monitor-hub';

export interface Env {
  /** Read once, by the hub's 1.x import. */
  FLAREWATCH_STATE?: KVNamespace;
  MONITOR_HUB?: DurableObjectNamespace<MonitorHub>;
  /** Sent as `Authorization: Bearer <token>` on every external proxy check. */
  FLAREWATCH_PROXY_TOKEN?: string;
  /** Webhooks as JSON, one or a list, that get alerts alongside `notification.webhook`. */
  FLAREWATCH_WEBHOOKS?: string;
  /** Root secret for ping tokens (base64url(HMAC-SHA256(secret, `v1:<id>`))). */
  HEARTBEAT_SECRET?: string;
  /** Workers rate-limiting binding, 30 requests per 60s per monitor. */
  HEARTBEAT_RATE_LIMIT?: RateLimit;
  /** Public status page origin for /ping-url; falls back to the requester's origin. */
  PUBLIC_ORIGIN?: string;
}

/** Every deployment has one hub; its name only has to be stable. */
export function getHub(env: Env): DurableObjectStub<MonitorHub> {
  if (!env.MONITOR_HUB) throw new Error('MONITOR_HUB binding not found');
  return env.MONITOR_HUB.getByName('flarewatch');
}

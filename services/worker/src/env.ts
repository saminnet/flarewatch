import type { MonitorHub } from './hub/monitor-hub';

export interface Env {
  FLAREWATCH_STATE?: KVNamespace;
  MONITOR_HUB?: DurableObjectNamespace<MonitorHub>;
  /** Sent as `Authorization: Bearer <token>` on every external proxy check. */
  FLAREWATCH_PROXY_TOKEN?: string;
  /** Root secret for ping tokens (base64url(HMAC-SHA256(secret, `v1:<id>`))). */
  HEARTBEAT_SECRET?: string;
  /** Workers rate-limiting binding, 30 requests per 60s per monitor. */
  HEARTBEAT_RATE_LIMIT?: RateLimit;
  /**
   * Public status page origin used to build ping URLs for /ping-url.
   * Falls back to the origin of the requesting status page.
   */
  PUBLIC_ORIGIN?: string;
}

export function getStateKv(env: Env): KVNamespace {
  if (!env.FLAREWATCH_STATE) throw new Error('FLAREWATCH_STATE binding not found');
  return env.FLAREWATCH_STATE;
}

/** Every deployment has one hub; its name only has to be stable. */
export function getHub(env: Env): DurableObjectStub<MonitorHub> {
  if (!env.MONITOR_HUB) throw new Error('MONITOR_HUB binding not found');
  return env.MONITOR_HUB.getByName('flarewatch');
}

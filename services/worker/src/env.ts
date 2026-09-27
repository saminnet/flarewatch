export interface Env {
  FLAREWATCH_STATE?: KVNamespace;
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

import {
  createLogger,
  loadRuntimeConfig,
  type RuntimeConfig,
  type WorkerConfig,
} from '@flarewatch/shared';

const log = createLogger('Worker');

export interface Env {
  CONFIG_KV?: KVNamespace;
  STATE_KV?: KVNamespace;
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
  const kv = env.STATE_KV ?? env.FLAREWATCH_STATE;
  if (!kv) {
    throw new Error('STATE_KV (or FLAREWATCH_STATE) binding not found');
  }
  return kv;
}

export async function loadEffectiveConfig(
  env: Env,
  staticConfig: WorkerConfig,
): Promise<RuntimeConfig> {
  if (env.CONFIG_KV) {
    const runtimeConfig = await loadRuntimeConfig(env.CONFIG_KV);
    if (runtimeConfig) {
      return runtimeConfig;
    }
    log.error('Invalid runtime config in CONFIG_KV, falling back to static config');
  }

  const config: RuntimeConfig = { monitors: staticConfig.monitors };
  if (staticConfig.notification) {
    config.notification = staticConfig.notification;
  }
  if (staticConfig.kvWriteCooldownMinutes !== undefined) {
    config.kvWriteCooldownMinutes = staticConfig.kvWriteCooldownMinutes;
  }
  return config;
}

import { loadRuntimeConfig, type RuntimeConfig } from '@flarewatch/shared';
import { pageConfig } from '@flarewatch/config';
import { workerConfig } from '@flarewatch/config/worker';
import { resolveRuntimeEnv } from './runtime-env';

const CACHE_TTL_MS = 30_000;
let cachedConfig: RuntimeConfig | null = null;
let cacheTime = 0;

function buildFallbackConfig(): RuntimeConfig {
  return {
    monitors: workerConfig.monitors,
    statusPage: pageConfig,
    ...(workerConfig.notification !== undefined && { notification: workerConfig.notification }),
    ...(workerConfig.kvWriteCooldownMinutes !== undefined && {
      kvWriteCooldownMinutes: workerConfig.kvWriteCooldownMinutes,
    }),
  };
}

function normalizeConfig(config: RuntimeConfig): RuntimeConfig {
  if (config.statusPage) return config;
  return { ...config, statusPage: pageConfig };
}

function cacheAndReturn(config: RuntimeConfig, now: number): RuntimeConfig {
  cachedConfig = config;
  cacheTime = now;
  return config;
}

export async function getConfig(): Promise<RuntimeConfig> {
  const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
  const now = Date.now();

  if (!isDev && cachedConfig && now - cacheTime < CACHE_TTL_MS) {
    return cachedConfig;
  }

  const env = await resolveRuntimeEnv();
  const kv = env?.CONFIG_KV;

  if (kv) {
    const runtime = await loadRuntimeConfig(kv);
    if (runtime) {
      return cacheAndReturn(normalizeConfig(runtime), now);
    }
  }

  return cacheAndReturn(buildFallbackConfig(), now);
}

export function invalidateConfigCache(): void {
  cachedConfig = null;
  cacheTime = 0;
}

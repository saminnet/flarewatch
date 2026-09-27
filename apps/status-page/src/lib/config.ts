import { createServerFn } from '@tanstack/react-start';
import { loadRuntimeConfig, type PageConfig, type RuntimeConfig } from '@flarewatch/shared';
import { pageConfig } from '@flarewatch/config';
import { workerConfig } from '@flarewatch/config/worker';
import { resolveRuntimeEnv } from './runtime-env';

// Valid 30s per warm isolate; isolates share no cache state and may be recycled.
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
  const isDev = import.meta.env.DEV;
  const now = Date.now();

  if (!isDev && cachedConfig && now - cacheTime < CACHE_TTL_MS) {
    return cachedConfig;
  }

  const env = await resolveRuntimeEnv();
  const kv = env.CONFIG_KV;

  if (kv) {
    const runtime = await loadRuntimeConfig(kv);
    if (runtime) {
      return cacheAndReturn(normalizeConfig(runtime), now);
    }
  }

  return cacheAndReturn(buildFallbackConfig(), now);
}

/**
 * Visitors get only the sign-in page. A site Basic Auth secret left over from
 * before private-only existed keeps the page closed instead of opening it.
 */
export function isPrivateOnly(config: RuntimeConfig, env: Cloudflare.Env): boolean {
  return (
    config.statusPage?.visibility === 'private' || Boolean(env.FLAREWATCH_STATUS_PAGE_BASIC_AUTH)
  );
}

/** What the page shell renders; safe to send to anyone, including visitors of a private page. */
export type PageBranding = Pick<
  PageConfig,
  'title' | 'favicon' | 'logo' | 'links' | 'poweredByUrl' | 'themeVars'
>;

export const getConfigServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ statusPage: PageBranding }> => {
    const { title, favicon, logo, links, poweredByUrl, themeVars } =
      (await getConfig()).statusPage ?? {};
    return { statusPage: { title, favicon, logo, links, poweredByUrl, themeVars } };
  },
);

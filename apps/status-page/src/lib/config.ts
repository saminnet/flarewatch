import { createServerFn } from '@tanstack/react-start';
import type { PageConfig, RuntimeConfig } from '@flarewatch/shared';
import { pageConfig } from '@flarewatch/config';
import { workerConfig } from '@flarewatch/config/worker';

// Built on call, not at module scope, so the client bundle can drop the monitor config.
export function getConfig(): RuntimeConfig {
  return { monitors: workerConfig.monitors, statusPage: pageConfig };
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
    const { title, favicon, logo, links, poweredByUrl, themeVars } = getConfig().statusPage ?? {};
    return { statusPage: { title, favicon, logo, links, poweredByUrl, themeVars } };
  },
);

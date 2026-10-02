import { createServerFn, createServerOnlyFn } from '@tanstack/react-start';
import type { PageConfig, RuntimeConfig } from '@flarewatch/shared';
import { pageConfig } from '@flarewatch/config';
import { workerConfig } from '@flarewatch/config/worker';

/**
 * Server-only, so the client build drops the config import: a worker.ts that
 * builds monitors with helper calls would otherwise ship whole to the browser.
 */
export const getConfig = createServerOnlyFn((): RuntimeConfig => ({
  monitors: workerConfig.monitors,
  statusPage: pageConfig,
}));

/** Visitors get only the sign-in page. */
export function isPrivateOnly(config: RuntimeConfig): boolean {
  return config.statusPage?.visibility === 'private';
}

/** What the page shell renders; safe to send to anyone, including visitors of a private page. */
export type PageBranding = Pick<PageConfig, 'title' | 'favicon' | 'logo' | 'links'>;

export const getConfigServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ statusPage: PageBranding }> => {
    const { title, favicon, logo, links } = getConfig().statusPage ?? {};
    return { statusPage: { title, favicon, logo, links } };
  },
);

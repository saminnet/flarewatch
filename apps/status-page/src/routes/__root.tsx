import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, redirect, retainSearchParams } from '@tanstack/react-router';
import { createMiddleware } from '@tanstack/react-start';
import { RootComponent } from '@/components/routes/root-component';
import { getThemePreferenceServerFn } from '@/lib/theme-server';
import { configQuery, sessionQuery, uiPrefsQuery, loadQuery } from '@/lib/query/monitors.queries';

import '@fontsource-variable/inter/wght.css';

import appCss from '../styles.css?url';

const authMiddleware = createMiddleware({ type: 'request' }).server(async (opts) => {
  const { authMiddlewareServer } = await import('../server/auth-middleware');
  return authMiddlewareServer(opts);
});

const DEFAULT_TITLE = 'FlareWatch';

interface RootSearch {
  view?: 'visitor';
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  server: {
    middleware: [authMiddleware],
  },
  validateSearch: (search): RootSearch => ({
    view: search.view === 'visitor' ? 'visitor' : undefined,
  }),
  search: {
    middlewares: [retainSearchParams<RootSearch>(['view'])],
  },
  beforeLoad: async ({ context, location }) => {
    const session = await loadQuery(context.queryClient, sessionQuery());
    // The server enforces this too; here it covers client-side navigation after sign-out.
    if (session.privateOnly && session.viewer === 'visitor' && location.pathname !== '/login') {
      throw redirect({ to: '/login' });
    }
    return { session };
  },
  loader: async ({ context }) => {
    const [theme, config] = await Promise.all([
      getThemePreferenceServerFn(),
      loadQuery(context.queryClient, configQuery()),
      loadQuery(context.queryClient, uiPrefsQuery()),
    ]);
    return {
      theme,
      statusPage: config.statusPage,
      title: config.statusPage?.title || DEFAULT_TITLE,
    };
  },
  head: ({ loaderData }) => {
    const title = loaderData?.title ?? DEFAULT_TITLE;
    const description = `Live status, uptime and incident history for ${title}.`;
    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: description },
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: title },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { name: 'twitter:card', content: 'summary' },
      ],
      links: [
        { rel: 'stylesheet', href: appCss },
        {
          rel: 'alternate',
          type: 'application/atom+xml',
          title: 'Status feed',
          href: '/feed.atom',
        },
      ],
    };
  },

  component: RootComponent,
});

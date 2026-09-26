import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, retainSearchParams } from '@tanstack/react-router';
import { createMiddleware } from '@tanstack/react-start';
import { RootComponent } from '@/components/routes/root-component';
import { getThemePreferenceServerFn } from '@/lib/theme-server';
import { configQuery, sessionQuery } from '@/lib/query/monitors.queries';

import '@fontsource-variable/inter/wght.css';

import appCss from '../styles.css?url';

const authMiddleware = createMiddleware({ type: 'request' }).server(async (opts) => {
  const { authMiddlewareServer } = await import('../server/auth-middleware');
  return authMiddlewareServer(opts);
});

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
  beforeLoad: async ({ context }) => ({
    session: await context.queryClient.ensureQueryData(sessionQuery()),
  }),
  loader: async ({ context }) => {
    const [theme, config] = await Promise.all([
      getThemePreferenceServerFn(),
      context.queryClient.ensureQueryData(configQuery()),
    ]);
    return { theme, statusPage: config.statusPage };
  },
  head: () => {
    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content: 'Open-source uptime monitoring for Cloudflare',
        },
      ],
      links: [{ rel: 'stylesheet', href: appCss }],
    };
  },

  component: RootComponent,
});

import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext } from '@tanstack/react-router';
import { createMiddleware } from '@tanstack/react-start';
import { RootComponent } from '@/components/routes/root-component';
import { getThemePreferenceServerFn } from '@/lib/theme-server';
import { configQuery } from '@/lib/query/monitors.queries';

// Initialize i18n
import '@/lib/i18n';
import '@fontsource-variable/inter/wght.css';

import appCss from '../styles.css?url';

const authMiddleware = createMiddleware({ type: 'request' }).server(async (opts) => {
  const { authMiddlewareServer } = await import('../server/auth-middleware');
  return authMiddlewareServer(opts);
});

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  server: {
    middleware: [authMiddleware],
  },
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

import type { QueryClient } from '@tanstack/react-query';
import { Outlet, HeadContent, Scripts, createRootRouteWithContext } from '@tanstack/react-router';
import { createMiddleware } from '@tanstack/react-start';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { getThemeInitScript, getThemePreferenceServerFn } from '@/lib/theme-server';
import { configQuery } from '@/lib/query/monitors.queries';

// Initialize i18n
import '@/lib/i18n';

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

function RootComponent() {
  const { theme, statusPage } = Route.useLoaderData();
  const themeInitScript = getThemeInitScript(theme);
  const isDark = theme === 'dark';
  const title = statusPage?.title || 'FlareWatch';
  const favicon = statusPage?.favicon;

  return (
    <html lang="en" className={`h-full${isDark ? ' dark' : ''}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <title>{title}</title>
        {favicon ? (
          <link rel="icon" href={favicon} />
        ) : (
          <>
            <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
            <link rel="icon" href="/favicon.ico" />
          </>
        )}
        <HeadContent />
      </head>
      <body className="flex min-h-full flex-col bg-white font-sans antialiased dark:bg-neutral-950">
        <Header config={statusPage} />

        <main className="flex-1">
          <Outlet />
        </main>

        <Footer config={statusPage} theme={theme} />

        <Scripts />
      </body>
    </html>
  );
}

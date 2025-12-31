import type { QueryClient } from '@tanstack/react-query';
import { Outlet, HeadContent, Scripts, createRootRouteWithContext } from '@tanstack/react-router';
import { createMiddleware } from '@tanstack/react-start';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { pageConfig } from '@flarewatch/config';
import type { ThemePreference } from '@/lib/theme-server';
import { getThemeInitScript, getThemePreferenceServerFn } from '@/lib/theme-server';

// Initialize i18n
import '@/lib/i18n';

import appCss from '../styles.css?url';
import interFontUrl from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';

const authMiddleware = createMiddleware({ type: 'request' }).server(async (opts) => {
  const { authMiddlewareServer } = await import('../server/auth-middleware');
  return await authMiddlewareServer(opts);
});

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  server: {
    middleware: [authMiddleware],
  },
  loader: async () => {
    const theme = await getThemePreferenceServerFn();
    return { theme };
  },
  head: () => {
    const icons = pageConfig.favicon
      ? [{ rel: 'icon', href: pageConfig.favicon }]
      : [
          { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
          { rel: 'icon', href: '/favicon.ico' },
        ];

    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { title: pageConfig.title || 'FlareWatch' },
        {
          name: 'description',
          content: 'Open-source uptime monitoring for Cloudflare',
        },
      ],
      links: [
        {
          rel: 'preload',
          href: interFontUrl,
          as: 'font',
          type: 'font/woff2',
          crossOrigin: 'anonymous',
        },
        { rel: 'stylesheet', href: appCss },
        ...icons,
      ],
    };
  },

  component: RootComponent,
});

function RootComponent() {
  const { theme } = Route.useLoaderData() as { theme: ThemePreference };
  const themeInitScript = getThemeInitScript(theme);
  const isDark = theme === 'dark';

  return (
    <html lang="en" className={`h-full${isDark ? ' dark' : ''}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <HeadContent />
      </head>
      <body className="flex min-h-full flex-col bg-white font-sans antialiased dark:bg-neutral-950">
        <Header config={pageConfig} />

        <main className="flex-1">
          <Outlet />
        </main>

        <Footer config={pageConfig} theme={theme} />

        <Scripts />
      </body>
    </html>
  );
}

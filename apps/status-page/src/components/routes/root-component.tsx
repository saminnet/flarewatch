import { getRouteApi, Outlet, HeadContent, Scripts } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { getThemeInitScript } from '@/lib/theme-server';
import { sanitizeThemeVars } from '@flarewatch/shared';

const rootRoute = getRouteApi('__root__');

export function RootComponent() {
  const { t } = useTranslation();
  const { theme, statusPage } = rootRoute.useLoaderData();
  const themeInitScript = getThemeInitScript(theme);
  const isDark = theme === 'dark';
  const title = statusPage?.title || 'FlareWatch';
  const favicon = statusPage?.favicon;
  const themeVars = sanitizeThemeVars(statusPage?.themeVars);

  return (
    <html lang="en" className={isDark ? 'h-full dark' : 'h-full'} suppressHydrationWarning>
      <head>
        <script>{themeInitScript}</script>
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

        {themeVars && <style>{themeVars}</style>}
      </head>
      <body className="flex min-h-full flex-col bg-white font-sans antialiased dark:bg-neutral-950">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-100 focus:bg-white focus:px-4 focus:py-2 focus:rounded-md focus:shadow-lg dark:focus:bg-neutral-900"
        >
          {t('nav.skipToContent')}
        </a>
        <Header config={statusPage} />

        <main id="main-content" className="flex-1">
          <Outlet />
        </main>

        <Footer config={statusPage} theme={theme} />

        <Scripts />
      </body>
    </html>
  );
}

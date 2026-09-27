import { getRouteApi, Outlet, HeadContent, Scripts } from '@tanstack/react-router';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { VisitorViewBar } from '@/components/visitor-view-bar';
import { getThemeInitScript } from '@/lib/theme-server';
import { sanitizeThemeVars } from '@flarewatch/shared';

const rootRoute = getRouteApi('__root__');

export function RootComponent() {
  const { theme, statusPage } = rootRoute.useLoaderData();
  const { session } = rootRoute.useRouteContext();
  const { view } = rootRoute.useSearch();
  const visitorView = session.viewer !== 'visitor' && view === 'visitor';
  const themeInitScript = getThemeInitScript(theme);
  const isDark = theme === 'dark';
  const title = statusPage?.title || 'FlareWatch';
  const favicon = statusPage?.favicon;
  const themeVars = sanitizeThemeVars(statusPage?.themeVars);

  return (
    <html
      lang="en"
      className={isDark ? 'h-full bg-background dark' : 'h-full bg-background'}
      suppressHydrationWarning
    >
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
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-100 focus:bg-card focus:px-4 focus:py-2 focus:rounded-md focus:shadow-lg"
        >
          Skip to main content
        </a>
        <Header config={statusPage} session={session} visitorView={visitorView} />
        {visitorView && <VisitorViewBar />}

        <main id="main-content" className="flex-1">
          <Outlet />
        </main>

        <Footer
          config={statusPage}
          theme={theme}
          showSignIn={session.viewer === 'visitor' && session.canSignIn}
        />

        <Scripts />
      </body>
    </html>
  );
}

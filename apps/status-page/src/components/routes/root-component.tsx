import {
  getRouteApi,
  Outlet,
  HeadContent,
  Scripts,
  useMatch,
  useRouter,
} from '@tanstack/react-router';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { VisitorViewBar } from '@/components/visitor-view-bar';
import { getThemeInitScript } from '@/lib/theme-server';

const rootRoute = getRouteApi('__root__');

export function RootComponent() {
  const { theme: themePreference, statusPage } = rootRoute.useLoaderData();
  const { session } = rootRoute.useRouteContext();
  // An embed sits in someone else's page: no site chrome, and its theme comes from the URL.
  const embedTheme = useMatch({ from: '/embed/$monitorId', shouldThrow: false })?.search.theme;
  const theme =
    embedTheme === undefined ? themePreference : embedTheme === 'auto' ? 'system' : embedTheme;
  const { view } = rootRoute.useSearch();
  const visitorView = session.viewer !== 'visitor' && view === 'visitor';
  const themeInitScript = getThemeInitScript(theme);
  const nonce = useRouter().options.ssr?.nonce;
  const isDark = theme === 'dark';
  const title = statusPage?.title || 'FlareWatch';
  const favicon = statusPage?.favicon;

  return (
    <html
      lang="en"
      className={isDark ? 'h-full bg-background dark' : 'h-full bg-background'}
      suppressHydrationWarning
    >
      <head>
        {/* Browsers hide a nonce from the DOM once the page loads, so hydration would see it missing. */}
        <script nonce={nonce} suppressHydrationWarning>
          {themeInitScript}
        </script>
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
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground antialiased">
        {embedTheme === undefined ? (
          <>
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
          </>
        ) : (
          <Outlet />
        )}

        <Scripts />
      </body>
    </html>
  );
}

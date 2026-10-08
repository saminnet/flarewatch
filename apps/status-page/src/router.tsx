import { createRouter } from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { createQueryClient } from '@/lib/query/client';
import { DefaultCatchBoundary } from '@/components/default-catch-boundary';
import { NotFound } from '@/components/not-found';
import { PageSkeleton } from '@/components/page-skeleton';
import { pageHydrated } from '@/lib/hooks/use-page-hydration';
import { cspNonce } from '@/server/csp-nonce';
import { routeTree } from './routeTree.gen';

// The client reads the nonce back from the csp-nonce meta tag the router renders.
const requestNonce = createIsomorphicFn().server(() => cspNonce(getRequest()));

export function getRouter() {
  const queryClient = createQueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    ssr: { nonce: requestNonce() },
    scrollRestoration: true,
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: () => <NotFound />,
    defaultPendingComponent: () => <PageSkeleton />,
    defaultPendingMinMs: 200,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // Page changes morph; filter and month changes on the same page stay instant.
    defaultViewTransition: { types: ({ pathChanged }) => (pathChanged ? ['page'] : false) },
  });

  setupRouterSsrQueryIntegration({ queryClient, router });

  // The header hydrates before the page under it, and a navigation in between makes the page throw.
  if (!router.isServer) {
    const unblock = router.history.block({
      blockerFn: () => pageHydrated.then(() => false),
      enableBeforeUnload: false,
    });
    void pageHydrated.then(unblock);
  }

  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}

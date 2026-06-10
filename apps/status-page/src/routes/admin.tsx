import { createFileRoute } from '@tanstack/react-router';
import { AdminPage } from '@/components/routes/admin-page';
import { publicMonitorsQuery, maintenancesQuery } from '@/lib/query/monitors.queries';
import { checkAdminAuthServerFn, type AdminAuthState } from '@/lib/auth-server';

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    const authState = await checkAdminAuthServerFn();
    return { authState };
  },
  loader: async ({ context }) => {
    // Access authState from beforeLoad context
    const { authState } = context as {
      authState: AdminAuthState;
      queryClient: typeof context.queryClient;
    };

    // Only prefetch data if authenticated
    if (authState === 'authenticated') {
      await Promise.all([
        context.queryClient.ensureQueryData(publicMonitorsQuery()),
        context.queryClient.ensureQueryData(maintenancesQuery()),
      ]);
    }

    // Capture timestamp at load time for SSR hydration consistency
    const loaderNowMs = Date.now();
    return { authState, loaderNowMs };
  },
  component: AdminPage,
});

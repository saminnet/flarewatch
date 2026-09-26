import { createFileRoute } from '@tanstack/react-router';
import { AdminPage } from '@/components/routes/admin-page';
import {
  adminMonitorsQuery,
  adminMaintenancesQuery,
  adminMonitorStateQuery,
} from '@/lib/query/monitors.queries';
import { checkAdminAuthServerFn } from '@/lib/auth-server';

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    const authState = await checkAdminAuthServerFn();
    return { authState };
  },
  loader: async ({ context }) => {
    const { authState } = context;

    if (authState === 'authenticated') {
      await Promise.all([
        context.queryClient.ensureQueryData(adminMonitorsQuery()),
        context.queryClient.ensureQueryData(adminMaintenancesQuery()),
        context.queryClient.ensureQueryData(adminMonitorStateQuery()),
      ]);
    }

    // Capture timestamp at load time for SSR hydration consistency
    const loaderNowMs = Date.now();
    return { authState, loaderNowMs };
  },
  component: AdminPage,
});

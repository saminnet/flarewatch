import { createFileRoute } from '@tanstack/react-router';
import { EventsPage } from '@/components/routes/events-page';
import { publicMonitorsQuery } from '@/lib/query/monitors.queries';
import { getMaintenances } from '@/lib/kv';
import { isValidYearMonth } from '@/lib/date';

interface EventsSearch {
  month?: string;
  monitor?: string;
  type?: 'all' | 'incident' | 'maintenance';
}

function getCurrentMonth(): string {
  // Use UTC to avoid server/client timezone hydration mismatches.
  return new Date().toISOString().slice(0, 7);
}

export const Route = createFileRoute('/events')({
  validateSearch: (search: Record<string, unknown>): EventsSearch => {
    const month = isValidYearMonth(search.month) ? search.month : getCurrentMonth();
    const monitor =
      typeof search.monitor === 'string' && search.monitor.length > 0 ? search.monitor : undefined;
    const type = search.type === 'incident' || search.type === 'maintenance' ? search.type : 'all';
    return { month, monitor, type };
  },
  loader: async ({ context }) => {
    const [, maintenances] = await Promise.all([
      context.queryClient.ensureQueryData(publicMonitorsQuery()),
      getMaintenances(),
    ]);

    const loaderNowMs = Date.now();
    return { maintenances, loaderNowMs };
  },
  component: EventsPage,
});

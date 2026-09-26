import { isNonEmptyString } from '@flarewatch/shared';
import { createFileRoute } from '@tanstack/react-router';
import { EventsPage } from '@/components/routes/events-page';
import { visitorSnapshotQuery } from '@/lib/query/monitors.queries';
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
  validateSearch: (search): EventsSearch => {
    const month = isValidYearMonth(search.month) ? search.month : getCurrentMonth();
    const monitor = isNonEmptyString(search.monitor) ? search.monitor : undefined;
    const type = search.type === 'incident' || search.type === 'maintenance' ? search.type : 'all';
    return { month, monitor, type };
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(visitorSnapshotQuery());
    return { loaderNowMs: Date.now() };
  },
  component: EventsPage,
});

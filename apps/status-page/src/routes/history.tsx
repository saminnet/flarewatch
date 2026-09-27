import { isNonEmptyString } from '@flarewatch/shared';
import { createFileRoute } from '@tanstack/react-router';
import { HistoryPage } from '@/components/routes/history-page';
import { snapshotQuery } from '@/lib/query/monitors.queries';
import { audienceOf } from '@/lib/session';
import { isValidYearMonth } from '@/lib/date';

interface HistorySearch {
  month?: string;
  monitor?: string;
  type?: 'all' | 'incident' | 'maintenance';
}

function getCurrentMonth(): string {
  // Use UTC to avoid server/client timezone hydration mismatches.
  return new Date().toISOString().slice(0, 7);
}

export const Route = createFileRoute('/history')({
  validateSearch: (search): HistorySearch => {
    const month = isValidYearMonth(search.month) ? search.month : getCurrentMonth();
    const monitor = isNonEmptyString(search.monitor) ? search.monitor : undefined;
    const type = search.type === 'incident' || search.type === 'maintenance' ? search.type : 'all';
    return { month, monitor, type };
  },
  loaderDeps: ({ search }) => ({ view: search.view }),
  loader: async ({ context, deps }) => {
    await context.queryClient.ensureQueryData(
      snapshotQuery(audienceOf(context.session, deps.view)),
    );
    return { loaderNowMs: Date.now() };
  },
  component: HistoryPage,
});

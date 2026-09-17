import { createFileRoute } from '@tanstack/react-router';
import { EmbedPage } from '@/components/routes/embed-monitor-page';
import { monitorStateQuery, publicMonitorsQuery } from '@/lib/query/monitors.queries';

interface EmbedSearch {
  theme?: 'light' | 'dark' | 'auto';
  minimal?: boolean;
}

export const Route = createFileRoute('/embed/$monitorId')({
  validateSearch: (search): EmbedSearch => {
    const theme = search.theme === 'light' || search.theme === 'dark' ? search.theme : 'auto';
    return {
      theme,
      minimal: search.minimal === 'true' || search.minimal === true,
    };
  },
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(monitorStateQuery()),
      context.queryClient.ensureQueryData(publicMonitorsQuery()),
    ]);
  },
  component: EmbedPage,
  errorComponent: ({ error }) => (
    <div className="h-full flex items-center justify-center p-4">
      <div className="text-sm text-destructive">
        {error instanceof Error ? error.message : 'Failed to load monitor status'}
      </div>
    </div>
  ),
});

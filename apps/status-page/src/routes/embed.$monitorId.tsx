import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { IconCircleCheck, IconCircleX } from '@tabler/icons-react';
import { monitorStateQuery, publicMonitorsQuery } from '@/lib/query/monitors.queries';
import {
  calculateUptimePercent,
  isMonitorUp,
  getMonitorError,
  getLatestLatency,
} from '@/lib/uptime';
import { getStatusColor } from '@/lib/color';
import { cn } from '@/lib/utils';

interface EmbedSearch {
  theme?: 'light' | 'dark' | 'auto';
  minimal?: boolean;
}

export const Route = createFileRoute('/embed/$monitorId')({
  validateSearch: (search: Record<string, unknown>): EmbedSearch => {
    return {
      theme: (search.theme as EmbedSearch['theme']) ?? 'auto',
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
});

function EmbedPage() {
  const { t } = useTranslation();
  const { monitorId } = Route.useParams();
  const { data: state } = useSuspenseQuery(monitorStateQuery());
  const { data: monitors } = useSuspenseQuery(publicMonitorsQuery());
  const { theme, minimal } = Route.useSearch();

  const monitor = monitors.find((m) => m.id === monitorId);

  // Determine theme class
  const themeClass = theme === 'dark' ? 'dark' : '';

  if (!monitor) {
    return (
      <div className={cn('h-full flex items-center justify-center p-4', themeClass)}>
        <div className="text-sm text-red-500">{t('error.monitorNotFound', { id: monitorId })}</div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className={cn('h-full flex items-center justify-center p-4', themeClass)}>
        <div className="text-sm text-neutral-500">{t('error.monitorStateNotDefined')}</div>
      </div>
    );
  }

  const isUp = isMonitorUp(monitor.id, state);
  const uptimePercent = calculateUptimePercent(monitor.id, state);
  const error = getMonitorError(monitor.id, state);
  const latency = getLatestLatency(monitor.id, state);
  const statusColor = getStatusColor(uptimePercent);

  // Minimal mode: just a status badge
  if (minimal) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium',
          themeClass,
        )}
      >
        <span className={cn('w-2 h-2 rounded-full', isUp ? 'bg-emerald-500' : 'bg-red-500')} />
        <span className={cn('font-mono', statusColor.text)}>{uptimePercent.toFixed(1)}%</span>
      </div>
    );
  }

  return (
    <div className={cn('p-3', themeClass)}>
      <div className="flex items-center gap-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3 shadow-sm">
        {/* Status Icon */}
        <div className="shrink-0">
          {isUp ? (
            <IconCircleCheck className="h-6 w-6 text-emerald-500" />
          ) : (
            <IconCircleX className="h-6 w-6 text-red-500" />
          )}
        </div>

        {/* Monitor Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm text-neutral-900 dark:text-neutral-100 truncate">
              {monitor.name}
            </h3>
          </div>
          {!isUp && error && <p className="text-xs text-red-500 truncate mt-0.5">{error}</p>}
          {isUp && latency && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              {t('monitor.latency', {
                ping: latency.ping,
                loc: latency.loc,
              })}
            </p>
          )}
        </div>

        {/* Uptime Badge */}
        <div
          className={cn(
            'px-2 py-1 rounded text-xs font-mono font-medium',
            isUp ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30',
            statusColor.text,
          )}
        >
          {uptimePercent.toFixed(2)}%
        </div>
      </div>
    </div>
  );
}

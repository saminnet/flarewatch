import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { StatusIcon } from '@/components/status-icon';
import { monitorStateQuery, publicMonitorsQuery } from '@/lib/query/monitors.queries';
import { useMonitorStatus } from '@/lib/hooks/use-monitor-status';
import { cn } from '@/lib/utils';

interface EmbedSearch {
  theme?: 'light' | 'dark' | 'auto';
  minimal?: boolean;
}

const VALID_THEMES = ['light', 'dark', 'auto'] as const;

export const Route = createFileRoute('/embed/$monitorId')({
  validateSearch: (search: Record<string, unknown>): EmbedSearch => {
    const theme = VALID_THEMES.includes(search.theme as (typeof VALID_THEMES)[number])
      ? (search.theme as EmbedSearch['theme'])
      : 'auto';
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
});

function EmbedPage() {
  const { t } = useTranslation();
  const { monitorId } = Route.useParams();
  const { data: state } = useSuspenseQuery(monitorStateQuery());
  const { data: monitors } = useSuspenseQuery(publicMonitorsQuery());
  const { theme, minimal } = Route.useSearch();

  const monitor = monitors.find((m) => m.id === monitorId);

  // Theme handling: 'dark' forces dark mode, 'light' forces light mode, 'auto' inherits
  // Using color-scheme CSS property ensures proper form controls and scrollbar colors
  const themeClass = theme === 'dark' ? 'dark' : '';
  const colorScheme = theme === 'auto' ? undefined : theme;

  if (!monitor) {
    return (
      <div
        className={cn('h-full flex items-center justify-center p-4', themeClass)}
        style={{ colorScheme }}
      >
        <div className="text-sm text-red-500">{t('error.monitorNotFound', { id: monitorId })}</div>
      </div>
    );
  }

  // State can be null if KV has no data yet (worker hasn't run)
  if (!state) {
    return (
      <div
        className={cn('h-full flex items-center justify-center p-4', themeClass)}
        style={{ colorScheme }}
      >
        <div className="text-sm text-neutral-500">{t('error.monitorStateNotDefined')}</div>
      </div>
    );
  }

  const { isUp, uptimePercent, error, latency, statusColor } = useMonitorStatus(monitor.id, state);

  // Minimal mode: just a status badge
  if (minimal) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium',
          themeClass,
        )}
        style={{ colorScheme }}
      >
        <span className={cn('w-2 h-2 rounded-full', isUp ? 'bg-emerald-500' : 'bg-red-500')} />
        <span className={cn('font-mono', statusColor.text)}>
          {uptimePercent !== null ? `${uptimePercent.toFixed(1)}%` : t('monitor.pending')}
        </span>
      </div>
    );
  }

  return (
    <div className={cn('p-3', themeClass)} style={{ colorScheme }}>
      <div className="flex items-center gap-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3 shadow-sm">
        <div className="shrink-0">
          <StatusIcon isUp={isUp} />
        </div>

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

        <div
          className={cn(
            'px-2 py-1 rounded text-xs font-mono font-medium',
            isUp ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30',
            statusColor.text,
          )}
        >
          {uptimePercent !== null ? `${uptimePercent.toFixed(2)}%` : t('monitor.pending')}
        </div>
      </div>
    </div>
  );
}

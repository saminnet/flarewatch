import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { StatusIcon } from '@/components/status-icon';
import { monitorStateQuery, publicMonitorsQuery } from '@/lib/query/monitors.queries';
import type { MonitorState } from '@flarewatch/shared';
import { useMonitorStatus } from '@/lib/hooks/use-monitor-status';
import { formatUptimeDisplay } from '@/lib/uptime';
import { cn } from '@/lib/utils';

interface EmbedSearch {
  theme?: 'light' | 'dark' | 'auto';
  minimal?: boolean;
}

const VALID_THEMES = ['light', 'dark', 'auto'] as const;

interface EmbedWrapperProps {
  children: React.ReactNode;
  theme: EmbedSearch['theme'];
  className?: string;
}

function EmbedWrapper({ children, theme, className }: EmbedWrapperProps): React.ReactNode {
  return (
    <div
      className={cn(className, theme === 'dark' && 'dark')}
      style={{ colorScheme: theme === 'auto' ? undefined : theme }}
    >
      {children}
    </div>
  );
}

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
  errorComponent: ({ error }) => (
    <div className="h-full flex items-center justify-center p-4">
      <div className="text-sm text-red-500">
        {error instanceof Error ? error.message : 'Failed to load monitor status'}
      </div>
    </div>
  ),
});

const EMPTY_STATE: MonitorState = {
  incident: {},
  latency: {},
  overallUp: 0,
  overallDown: 0,
  lastUpdate: 0,
  startedAt: {},
};

function EmbedPage() {
  const { t } = useTranslation();
  const { monitorId } = Route.useParams();
  const { data: state } = useSuspenseQuery(monitorStateQuery());
  const { data: monitors } = useSuspenseQuery(publicMonitorsQuery());
  const { theme, minimal } = Route.useSearch();

  const monitor = monitors.find((m) => m.id === monitorId);

  // Call hooks unconditionally to satisfy Rules of Hooks
  const { isUp, uptimePercent, error, latency, statusColor } = useMonitorStatus(
    monitorId,
    state ?? EMPTY_STATE,
  );
  const hasStarted = state ? !!state.startedAt?.[monitorId] : false;

  if (!monitor) {
    return (
      <EmbedWrapper theme={theme} className="h-full flex items-center justify-center p-4">
        <div className="text-sm text-red-500">{t('error.monitorNotFound', { id: monitorId })}</div>
      </EmbedWrapper>
    );
  }

  if (!state) {
    return (
      <EmbedWrapper theme={theme} className="h-full flex items-center justify-center p-4">
        <div className="text-sm text-neutral-500">{t('error.monitorStateNotDefined')}</div>
      </EmbedWrapper>
    );
  }

  if (minimal) {
    return (
      <EmbedWrapper
        theme={theme}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium"
      >
        <span className={cn('w-2 h-2 rounded-full', isUp ? 'bg-emerald-500' : 'bg-red-500')} />
        <span className={cn('font-mono', statusColor.text)}>
          {formatUptimeDisplay(uptimePercent, hasStarted, 1, t)}
        </span>
      </EmbedWrapper>
    );
  }

  return (
    <EmbedWrapper theme={theme} className="p-3">
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
          {formatUptimeDisplay(uptimePercent, hasStarted, 2, t)}
        </div>
      </div>
    </EmbedWrapper>
  );
}

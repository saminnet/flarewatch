import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { StatusIcon } from '@/components/status-icon';
import { monitorStateQuery, publicMonitorsQuery } from '@/lib/query/monitors.queries';
import type { MonitorState } from '@flarewatch/shared';
import { useMonitorStatus } from '@/lib/hooks/use-monitor-status';
import { formatUptimeDisplay } from '@/lib/uptime';
import { cn } from '@/lib/utils';

type EmbedTheme = 'light' | 'dark' | 'auto';

interface EmbedWrapperProps {
  children: React.ReactNode;
  theme: EmbedTheme | undefined;
  className?: string;
}

const embedRoute = getRouteApi('/embed/$monitorId');

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

const EMPTY_STATE: MonitorState = {
  incident: {},
  latency: {},
  overallUp: 0,
  overallDown: 0,
  lastUpdate: 0,
  startedAt: {},
};

export function EmbedPage() {
  const { t } = useTranslation();
  const { monitorId } = embedRoute.useParams();
  const { data: state } = useSuspenseQuery(monitorStateQuery());
  const { data: monitors } = useSuspenseQuery(publicMonitorsQuery());
  const { theme, minimal } = embedRoute.useSearch();

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
        <div className="text-sm text-destructive">
          {t('error.monitorNotFound', { id: monitorId })}
        </div>
      </EmbedWrapper>
    );
  }

  if (!state) {
    return (
      <EmbedWrapper theme={theme} className="h-full flex items-center justify-center p-4">
        <div className="text-sm text-muted-foreground">{t('error.monitorStateNotDefined')}</div>
      </EmbedWrapper>
    );
  }

  if (minimal) {
    return (
      <EmbedWrapper
        theme={theme}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium"
      >
        <span
          className={cn('w-2 h-2 rounded-full', isUp ? 'bg-status-operational' : 'bg-status-down')}
        />
        <span className={cn('font-mono', statusColor.text)}>
          {formatUptimeDisplay(uptimePercent, hasStarted, 1, t)}
        </span>
      </EmbedWrapper>
    );
  }

  return (
    <EmbedWrapper theme={theme} className="p-3">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
        <div className="shrink-0">
          <StatusIcon isUp={isUp} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm text-foreground truncate">{monitor.name}</h3>
          </div>
          {!isUp && error && <p className="text-xs text-status-down truncate mt-0.5">{error}</p>}
          {isUp && latency && (
            <p className="text-xs text-muted-foreground mt-0.5">
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
            isUp ? 'bg-status-operational-bg' : 'bg-status-down-bg',
            statusColor.text,
          )}
        >
          {formatUptimeDisplay(uptimePercent, hasStarted, 2, t)}
        </div>
      </div>
    </EmbedWrapper>
  );
}

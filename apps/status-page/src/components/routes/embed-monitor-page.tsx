import { useSuspenseQuery } from '@tanstack/react-query';
import type { StatusView } from '@flarewatch/shared';
import { getRouteApi } from '@tanstack/react-router';
import { StatusIcon } from '@/components/status-icon';
import { snapshotQuery } from '@/lib/query/monitors.queries';
import { useMonitorStatus } from '@/lib/hooks/use-monitor-status';
import { monitorState, type MonitorState } from '@/lib/monitor-state';
import { formatUptimeDisplay } from '@/lib/uptime';
import { cn } from '@/lib/utils';

const embedRoute = getRouteApi('/embed/$monitorId');

const EMPTY_STATE: StatusView = { lastUpdate: 0, monitors: {} };

const STATE_CLASSES: Record<MonitorState, { dot: string; chip: string }> = {
  up: { dot: 'bg-status-operational', chip: 'bg-status-operational-bg' },
  running: { dot: 'bg-status-operational', chip: 'bg-status-operational-bg' },
  pending: { dot: 'bg-status-unknown', chip: 'bg-status-unknown-bg' },
  degraded: { dot: 'bg-status-degraded', chip: 'bg-status-degraded-bg' },
  down: { dot: 'bg-status-down', chip: 'bg-status-down-bg' },
};

export function EmbedPage() {
  const { monitorId } = embedRoute.useParams();
  const {
    data: { state, monitors, maintenances },
  } = useSuspenseQuery(snapshotQuery('visitor'));
  const { minimal } = embedRoute.useSearch();

  const monitor = monitors.find((m) => m.id === monitorId);

  const { uptimePercent, error, latency, statusColor } = useMonitorStatus(
    monitorId,
    state ?? EMPTY_STATE,
  );
  const hasStarted = state?.monitors[monitorId]?.startedAt !== undefined;

  if (!monitor) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-sm text-destructive">{`Monitor with ID ${monitorId} not found.`}</div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-sm text-muted-foreground">
          Monitor state is unavailable. Check that the monitoring worker is deployed.
        </div>
      </div>
    );
  }

  const shown = monitorState(monitor, state, maintenances);

  if (minimal) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium">
        <span className={cn('w-2 h-2 rounded-full', STATE_CLASSES[shown].dot)} />
        <span className={cn('font-mono', statusColor.text)}>
          {formatUptimeDisplay(uptimePercent, hasStarted, 1)}
        </span>
      </div>
    );
  }

  return (
    <div className="p-3">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
        <div className="shrink-0">
          <StatusIcon state={shown} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm text-foreground truncate">{monitor.name}</h3>
          </div>
          {shown === 'down' && error && (
            <p className="text-xs text-status-down-text truncate mt-0.5">{error}</p>
          )}
          {shown !== 'down' && latency && (
            <p
              className={cn(
                'text-xs mt-0.5',
                shown === 'degraded' && monitor.maxLatencyMs !== undefined
                  ? 'text-status-degraded-text'
                  : 'text-muted-foreground',
              )}
            >
              {`${latency.ping}ms (edge ${latency.loc})`}
            </p>
          )}
        </div>

        <div
          className={cn(
            'px-2 py-1 rounded text-xs font-mono font-medium',
            STATE_CLASSES[shown].chip,
            statusColor.text,
          )}
        >
          {formatUptimeDisplay(uptimePercent, hasStarted, 2)}
        </div>
      </div>
    </div>
  );
}

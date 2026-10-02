import { IconCircleCheck, IconAlertTriangle, IconCircleX, IconRefresh } from '@tabler/icons-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatUtcShort, type Maintenance, type StatusView } from '@flarewatch/shared';
import { countStatuses, getOverallStatus } from '@/lib/monitor-state';
import type { PublicMonitor } from '@/lib/public-view';
import { useAutoRefresh } from '@/lib/hooks/use-auto-refresh';
import { cn } from '@/lib/utils';

interface OverallStatusProps {
  monitors: PublicMonitor[];
  state: StatusView;
  maintenances: Maintenance[];
}

const statusConfig = {
  operational: {
    icon: IconCircleCheck,
    title: 'All systems operational',
    bgClass: 'bg-status-operational-bg',
    borderClass: 'border border-status-operational-border',
    iconClass: 'text-status-operational',
    badgeVariant: 'default' as const,
  },
  degraded: {
    icon: IconAlertTriangle,
    title: 'Some systems are down',
    bgClass: 'bg-status-degraded-bg',
    borderClass: 'border border-status-degraded-border',
    iconClass: 'text-status-degraded',
    badgeVariant: 'secondary' as const,
  },
  down: {
    icon: IconCircleX,
    title: 'All systems down',
    bgClass: 'bg-status-down-bg',
    borderClass: 'border border-status-down-border',
    iconClass: 'text-status-down',
    badgeVariant: 'destructive' as const,
  },
};

export function OverallStatus({ monitors, state, maintenances }: OverallStatusProps) {
  const counts = countStatuses(monitors, state, maintenances);
  const { up, late, slow, down } = counts;
  const monitorCount = monitors.length;
  const jobCount = monitors.filter((monitor) => monitor.method === 'HEARTBEAT').length;
  const status = getOverallStatus(counts);
  const { currentTime, isStale, willRefreshSoon, refreshCountdown } = useAutoRefresh({
    lastUpdate: state.lastUpdate,
  });

  const config = statusConfig[status];
  const StatusIcon = config.icon;
  const isInitialState = state.lastUpdate === 0;
  const secondsAgo = currentTime - state.lastUpdate;

  function getStatusTitle(): [title: string, count?: string] {
    if (status !== 'degraded') return [config.title];

    if (down === 0) {
      if (slow === 0) return ['Some jobs are running late', `(${late} out of ${jobCount})`];
      if (late === 0) {
        return ['Some systems are slow', `(${slow} out of ${monitorCount - jobCount})`];
      }
      return ['Some systems are degraded', `(${late + slow} out of ${monitorCount})`];
    }
    return ['Some systems are down', `(${down} out of ${monitorCount})`];
  }

  const [title, count] = getStatusTitle();

  function getRefreshMessage(): string {
    if (refreshCountdown !== null && refreshCountdown > 0) {
      return `Refreshing in ${refreshCountdown}s`;
    }
    if (willRefreshSoon) {
      return 'Refreshing...';
    }
    return 'Data is stale';
  }

  return (
    <Card className={cn('p-0 shadow-none ring-0', config.bgClass, config.borderClass)}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className={cn('rounded-full p-1.5', config.bgClass)}>
          <StatusIcon className={cn('h-6 w-6', config.iconClass)} />
        </div>

        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h2 className="text-base sm:text-lg font-semibold text-balance text-foreground">
              {title}
              {count && (
                <span className="whitespace-nowrap font-normal text-muted-foreground">
                  {' '}
                  {count}
                </span>
              )}
            </h2>
            <Badge variant={config.badgeVariant} className="shrink-0">
              {[`${up} up`, late > 0 && `${late} late`, slow > 0 && `${slow} slow`, `${down} down`]
                .filter(Boolean)
                .join(' / ')}
            </Badge>
          </div>

          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <p className="text-xs text-muted-foreground">
              {isInitialState
                ? 'Running first check...'
                : `Last updated ${formatUtcShort(state.lastUpdate)} (${secondsAgo}s ago)`}
            </p>

            {!isInitialState && isStale && (
              <Tooltip>
                <TooltipTrigger
                  className={cn(
                    'flex cursor-help items-center gap-1.5 text-xs text-status-degraded-text',
                    !willRefreshSoon && 'animate-pulse',
                  )}
                >
                  <IconRefresh className={cn('h-3.5 w-3.5', willRefreshSoon && 'animate-spin')} />
                  <span>{getRefreshMessage()}</span>
                </TooltipTrigger>
                <TooltipContent>
                  Page will auto-refresh when data is more than 5 minutes old
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

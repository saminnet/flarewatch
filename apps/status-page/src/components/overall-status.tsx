import { IconCircleCheck, IconAlertTriangle, IconCircleX, IconRefresh } from '@tabler/icons-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { MonitorState } from '@flarewatch/shared';
import { getOverallStatus } from '@/lib/uptime';
import { useAutoRefresh } from '@/lib/hooks/use-auto-refresh';
import { cn } from '@/lib/utils';

interface OverallStatusProps {
  state: MonitorState;
  monitorCount: number;
  jobCount: number;
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

export function OverallStatus({ state, monitorCount, jobCount }: OverallStatusProps) {
  const status = getOverallStatus(state);
  const { currentTime, isStale, willRefreshSoon, refreshCountdown } = useAutoRefresh({
    lastUpdate: state.lastUpdate,
  });

  const config = statusConfig[status];
  const StatusIcon = config.icon;
  const isInitialState = state.lastUpdate === 0;
  const secondsAgo = currentTime - state.lastUpdate;
  const late = state.overallLate ?? 0;

  function formatLastUpdated(): string {
    return new Date(state.lastUpdate * 1000)
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d{3}Z$/, ' UTC');
  }

  function getStatusTitle(): string {
    if (status !== 'degraded') return config.title;

    if (state.overallDown === 0) {
      return `Some jobs are running late (${late} out of ${jobCount})`;
    }
    return `Some systems are down (${state.overallDown} out of ${monitorCount})`;
  }

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
            <h2 className="text-base sm:text-lg font-semibold text-foreground">
              {getStatusTitle()}
            </h2>
            <Badge variant={config.badgeVariant} className="shrink-0">
              {late > 0
                ? `${state.overallUp - late} up / ${late} late / ${state.overallDown} down`
                : `${state.overallUp - late} up / ${state.overallDown} down`}
            </Badge>
          </div>

          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <p className="text-xs text-muted-foreground">
              {isInitialState
                ? 'Running first check...'
                : `Last updated ${formatLastUpdated()} (${secondsAgo}s ago)`}
            </p>

            {!isInitialState && isStale && (
              <Tooltip>
                <TooltipTrigger
                  className={cn(
                    'flex cursor-help items-center gap-1.5 text-xs text-status-degraded',
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

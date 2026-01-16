import { useTranslation } from 'react-i18next';
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
}

const statusConfig = {
  operational: {
    icon: IconCircleCheck,
    titleKey: 'status.allOperational' as const,
    bgClass: 'bg-emerald-50 dark:bg-emerald-950/30',
    borderClass: 'border border-emerald-200 dark:border-emerald-900',
    iconClass: 'text-emerald-500',
    badgeVariant: 'default' as const,
  },
  degraded: {
    icon: IconAlertTriangle,
    titleKey: 'status.someDown' as const,
    bgClass: 'bg-amber-50 dark:bg-amber-950/30',
    borderClass: 'border-amber-200 dark:border-amber-900',
    iconClass: 'text-amber-500',
    badgeVariant: 'secondary' as const,
  },
  down: {
    icon: IconCircleX,
    titleKey: 'status.allDown' as const,
    bgClass: 'bg-red-50 dark:bg-red-950/30',
    borderClass: 'border-red-200 dark:border-red-900',
    iconClass: 'text-red-500',
    badgeVariant: 'destructive' as const,
  },
};

export function OverallStatus({ state }: OverallStatusProps) {
  const { t } = useTranslation();
  const status = getOverallStatus(state);
  const { currentTime, isStale, willRefreshSoon, refreshCountdown } = useAutoRefresh({
    lastUpdate: state.lastUpdate,
  });

  const config = statusConfig[status];
  const StatusIcon = config.icon;
  const isInitialState = state.lastUpdate === 0;
  const secondsAgo = currentTime - state.lastUpdate;

  function formatLastUpdated(): string {
    return new Date(state.lastUpdate * 1000)
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d{3}Z$/, ' UTC');
  }

  function getStatusTitle(): string {
    if (status === 'degraded') {
      return t('status.someDown', {
        down: state.overallDown,
        total: state.overallUp + state.overallDown,
      });
    }
    return t(config.titleKey);
  }

  function getRefreshMessage(): string {
    if (refreshCountdown !== null && refreshCountdown > 0) {
      return t('status.refreshingIn', { seconds: refreshCountdown });
    }
    if (willRefreshSoon) {
      return t('status.refreshing');
    }
    return t('status.stale');
  }

  return (
    <Card className={cn(config.bgClass, config.borderClass)}>
      <div className="flex items-start gap-2">
        <div className={cn('ml-2 rounded-full p-2', config.bgClass)}>
          <StatusIcon className={cn('h-8 w-8', config.iconClass)} />
        </div>

        <div className="flex-1 pr-2">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h2 className="text-lg sm:text-xl font-semibold text-neutral-900 dark:text-neutral-100">
              {getStatusTitle()}
            </h2>
            <Badge variant={config.badgeVariant} className="shrink-0">
              {state.overallUp} up / {state.overallDown} down
            </Badge>
          </div>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              {isInitialState
                ? t('status.initializing')
                : t('status.lastUpdated', {
                    date: formatLastUpdated(),
                    seconds: secondsAgo,
                  })}
            </p>

            {!isInitialState && isStale && (
              <Tooltip>
                <TooltipTrigger
                  className={cn(
                    'flex cursor-help items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400',
                    !willRefreshSoon && 'animate-pulse',
                  )}
                >
                  <IconRefresh className={cn('h-3.5 w-3.5', willRefreshSoon && 'animate-spin')} />
                  <span>{getRefreshMessage()}</span>
                </TooltipTrigger>
                <TooltipContent>{t('status.autoRefresh')}</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

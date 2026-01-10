import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconCircleCheck,
  IconCircleX,
  IconExternalLink,
  IconChevronDown,
} from '@tabler/icons-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusBar } from '@/components/status-bar';
import type { MonitorState } from '@flarewatch/shared';
import { useHydrated } from '@/lib/hooks/use-hydrated';
import type { PublicMonitor } from '@/lib/monitors';
import {
  calculateUptimePercent,
  isMonitorUp,
  getMonitorError,
  getLatestLatency,
} from '@/lib/uptime';
import { getStatusColor } from '@/lib/color';
import { formatColoLabel } from '@/lib/cf-colos';
import { cn } from '@/lib/utils';

function ChartSkeleton() {
  return (
    <div className="h-37.5 w-full rounded-md border border-dashed border-neutral-200 dark:border-neutral-800" />
  );
}

function ChartLoadError() {
  const { t } = useTranslation();
  return (
    <div className="h-37.5 w-full flex items-center justify-center rounded-md border border-dashed border-neutral-200 dark:border-neutral-800">
      <span className="text-xs text-neutral-400">{t('error.chartLoadFailed')}</span>
    </div>
  );
}

const LazyLatencyChart = lazy(() =>
  import('@/components/latency-chart')
    .then((module) => ({ default: module.LatencyChart }))
    .catch(() => ({ default: ChartLoadError })),
);

interface MonitorCardProps {
  monitor: PublicMonitor;
  state: MonitorState;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function MonitorCard({ monitor, state, open, onOpenChange }: MonitorCardProps) {
  const { t } = useTranslation();
  const isHydrated = useHydrated();

  const isUp = isMonitorUp(monitor.id, state);
  const uptimePercent = calculateUptimePercent(monitor.id, state);
  const error = getMonitorError(monitor.id, state);
  const latency = getLatestLatency(monitor.id, state);
  const statusColor = getStatusColor(uptimePercent);

  const coloLabel = latency ? formatColoLabel(latency.loc) : null;

  return (
    <Card className="overflow-hidden p-0">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger
          nativeButton={false}
          render={<div />}
          className="w-full text-left"
          aria-label={t('monitor.toggleMonitor', {
            name: monitor.name,
            status: isUp ? t('monitor.statusUp') : t('monitor.statusDown'),
            uptime: uptimePercent.toFixed(2),
          })}
        >
          <div className="flex items-center gap-3 p-3 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors">
            <div className="shrink-0">
              {isUp ? (
                <IconCircleCheck className="h-6 w-6 text-emerald-500" />
              ) : (
                <IconCircleX className="h-6 w-6 text-red-500" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2 min-w-0">
                {monitor.link ? (
                  <a
                    href={monitor.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="group flex items-start gap-1.5 font-medium text-neutral-900 dark:text-neutral-100 min-w-0 hover:underline"
                  >
                    <span className="line-clamp-2 wrap-break-word sm:line-clamp-1">
                      {monitor.name}
                    </span>
                    <IconExternalLink className="hidden sm:inline-flex h-3.5 w-3.5 shrink-0 text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300" />
                  </a>
                ) : (
                  <h3 className="font-medium text-neutral-900 dark:text-neutral-100 min-w-0">
                    <span className="line-clamp-2 wrap-break-word sm:line-clamp-1">
                      {monitor.name}
                    </span>
                  </h3>
                )}
                {monitor.tooltip && (
                  <Tooltip>
                    <TooltipTrigger
                      className="text-xs text-neutral-400 cursor-help"
                      onClick={(e) => e.stopPropagation()}
                    >
                      ⓘ
                    </TooltipTrigger>
                    <TooltipContent>{monitor.tooltip}</TooltipContent>
                  </Tooltip>
                )}
              </div>

              {!isUp && error && <p className="text-xs text-red-500 truncate mt-0.5">{error}</p>}
              {latency && (
                <div className="sm:hidden mt-1 flex items-center gap-1.5 text-xs text-neutral-400">
                  <span className="font-medium text-neutral-600 dark:text-neutral-300">
                    {latency.ping}ms
                  </span>
                  <span aria-hidden="true">•</span>
                  <span>{latency.loc}</span>
                </div>
              )}
            </div>

            {latency && (
              <div className="hidden sm:flex items-center gap-1.5 text-right whitespace-nowrap">
                <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  {latency.ping}ms
                </span>
                <span className="text-xs text-neutral-400" aria-hidden="true">
                  •
                </span>
                {monitor.isProxy ? (
                  <span className="text-xs text-neutral-400">{latency.loc}</span>
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      className="text-xs text-neutral-400 cursor-help"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {latency.loc}
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="flex flex-col gap-1">
                        <div className="font-medium">
                          <span className="font-mono">{latency.loc}</span>
                          {coloLabel ? <span>{` — ${coloLabel}`}</span> : null}
                        </div>
                        <div className="opacity-80">{t('monitor.checkLocation.cloudflare')}</div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}

            <Badge
              variant="outline"
              className={cn('font-mono', statusColor.text, statusColor.border)}
            >
              {uptimePercent.toFixed(2)}%
            </Badge>

            <IconChevronDown
              className={cn('h-4 w-4 text-neutral-400 transition-transform', open && 'rotate-180')}
            />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t border-neutral-200 dark:border-neutral-800 p-3 bg-neutral-50/50 dark:bg-neutral-900/50">
            <div className="mb-2">
              <StatusBar monitorId={monitor.id} monitorName={monitor.name} state={state} />
            </div>

            {open && !monitor.hideLatencyChart && (
              <div className="mt-2">
                <h4 className="mb-2 text-xs font-medium text-neutral-500">
                  {t('monitor.responseTimes')}
                </h4>
                {isHydrated ? (
                  <Suspense fallback={<ChartSkeleton />}>
                    <LazyLatencyChart monitor={monitor} state={state} />
                  </Suspense>
                ) : (
                  <ChartSkeleton />
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

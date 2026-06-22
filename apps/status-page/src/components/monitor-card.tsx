import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import { IconExternalLink, IconChevronDown } from '@tabler/icons-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusBar } from '@/components/status-bar';
import { StatusIcon } from '@/components/status-icon';
import type { MonitorState } from '@flarewatch/shared';
import { useHydrated } from '@/lib/hooks/use-hydrated';
import { useMonitorStatus } from '@/lib/hooks/use-monitor-status';
import type { PublicMonitor } from '@/lib/monitors';
import { formatColoLabel } from '@/lib/cf-colos';
import { formatUptimeDisplay } from '@/lib/uptime';
import { cn } from '@/lib/utils';

function ChartSkeleton() {
  return <div className="h-32 w-full rounded-md border border-dashed border-border" />;
}

function ChartLoadError() {
  const { t } = useTranslation();
  return (
    <div className="h-32 w-full flex items-center justify-center rounded-md border border-dashed border-border">
      <span className="text-xs text-muted-foreground">{t('error.chartLoadFailed')}</span>
    </div>
  );
}

const LazyLatencyChart = lazy(() =>
  import('@/components/latency-chart')
    .then((module) => ({ default: module.LatencyChart }))
    .catch((err) => {
      console.error('Failed to load LatencyChart:', err);
      return { default: ChartLoadError };
    }),
);

interface MonitorCardProps {
  monitor: PublicMonitor;
  state: MonitorState;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function MonitorCard({
  monitor,
  state,
  open,
  onOpenChange,
  className,
  style,
}: MonitorCardProps) {
  const { t } = useTranslation();
  const isHydrated = useHydrated();
  const { isUp, uptimePercent, error, latency, statusColor } = useMonitorStatus(monitor.id, state);

  const coloLabel = latency ? formatColoLabel(latency.loc) : null;
  const hasStarted = !!state.startedAt?.[monitor.id];

  return (
    <Card className={cn('overflow-hidden p-0', className)} style={style}>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger
          nativeButton={false}
          render={<div />}
          className="w-full text-left"
          aria-label={t('monitor.toggleMonitor', {
            name: monitor.name,
            status: isUp ? t('monitor.statusUp') : t('monitor.statusDown'),
            uptime: formatUptimeDisplay(uptimePercent, hasStarted, 2, t),
          })}
        >
          <div className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 transition-colors">
            <div className="shrink-0">
              <StatusIcon isUp={isUp} />
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
                    className="group flex items-start gap-1.5 font-medium text-foreground min-w-0 hover:underline"
                  >
                    <span className="line-clamp-2 wrap-break-word sm:line-clamp-1">
                      {monitor.name}
                    </span>
                    <IconExternalLink className="hidden sm:inline-flex h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                  </a>
                ) : (
                  <h3 className="font-medium text-foreground min-w-0">
                    <span className="line-clamp-2 wrap-break-word sm:line-clamp-1">
                      {monitor.name}
                    </span>
                  </h3>
                )}
                {monitor.tooltip && (
                  <Tooltip>
                    <TooltipTrigger
                      className="text-xs text-muted-foreground cursor-help"
                      onClick={(e) => e.stopPropagation()}
                    >
                      ⓘ
                    </TooltipTrigger>
                    <TooltipContent>{monitor.tooltip}</TooltipContent>
                  </Tooltip>
                )}
              </div>

              {!isUp && error && (
                <p className="text-xs text-status-down truncate mt-0.5">{error}</p>
              )}
              {latency && (
                <div className="sm:hidden mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{latency.ping}ms</span>
                  <span aria-hidden="true">•</span>
                  <span>{latency.loc}</span>
                </div>
              )}
            </div>

            {latency && (
              <div className="hidden sm:flex items-center gap-1.5 text-right whitespace-nowrap">
                <span className="text-sm font-medium text-foreground">{latency.ping}ms</span>
                <span className="text-xs text-muted-foreground" aria-hidden="true">
                  •
                </span>
                {monitor.isProxy ? (
                  <span className="text-xs text-muted-foreground">{latency.loc}</span>
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      className="text-xs text-muted-foreground cursor-help"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {latency.loc}
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="flex flex-col gap-1">
                        <div className="font-medium">
                          <span className="font-mono">{latency.loc}</span>
                          {coloLabel && <span>{` — ${coloLabel}`}</span>}
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
              {formatUptimeDisplay(uptimePercent, hasStarted, 2, t)}
            </Badge>

            <IconChevronDown
              className={cn(
                'h-4 w-4 text-muted-foreground transition-transform',
                open && 'rotate-180',
              )}
            />
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t border-border px-3 py-2 bg-muted/30">
            <div className="mb-2">
              <StatusBar monitorId={monitor.id} monitorName={monitor.name} state={state} />
            </div>

            {open && !monitor.hideLatencyChart && (
              <div className="mt-2">
                <h4 className="mb-2 text-xs font-medium text-muted-foreground">
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

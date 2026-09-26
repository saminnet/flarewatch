import type { ReactNode } from 'react';
import { IconExternalLink, IconChevronDown, IconEyeOff } from '@tabler/icons-react';
import type { HeartbeatStatus } from '@flarewatch/shared';
import { formatUtcShort } from '@flarewatch/shared';
import { UPTIME_DAYS } from '@/lib/constants';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusBar } from '@/components/status-bar';
import { StatusIcon } from '@/components/status-icon';
import { RunStrip } from '@/components/run-strip';
import type { MonitorState } from '@flarewatch/shared';
import { useMonitorStatus } from '@/lib/hooks/use-monitor-status';
import type { AdminMonitor } from '@/lib/public-view';
import { deriveHeartbeat, type HeartbeatView } from '@/lib/heartbeat';
import { formatColoLabel } from '@/lib/cf-colos';
import { formatCadence, formatDuration } from '@/lib/date';
import { formatUptimeDisplay } from '@/lib/uptime';
import { LatencyChart } from '@/components/latency-chart';
import { cn } from '@/lib/utils';

interface MonitorCardProps {
  monitor: AdminMonitor;
  state: MonitorState;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  pingUrlSlot?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const PHASE_STATUS_LABELS: Record<HeartbeatStatus, string> = {
  up: 'operational',
  late: 'running late',
  pending: 'waiting for first ping',
  running: 'running',
  down: 'overdue',
};

const PHASE_BADGE_CLASS: Record<HeartbeatStatus, string> = {
  up: 'text-status-operational border-status-operational',
  running: 'text-status-operational border-status-operational',
  late: 'text-status-degraded-text border-status-degraded',
  down: 'text-status-down-text border-status-down',
  pending: 'text-muted-foreground border-border',
};

function UtcTime({ sec, className }: { sec: number; className?: string }) {
  return (
    <time
      className={cn('whitespace-nowrap', className)}
      dateTime={new Date(sec * 1000).toISOString()}
    >
      {formatUtcShort(sec)}
    </time>
  );
}

function HeartbeatMeta({ heartbeat }: { heartbeat: HeartbeatView }) {
  if (heartbeat.lastRunSec === undefined) return null;

  return (
    <>
      last run{' '}
      <UtcTime sec={heartbeat.lastRunSec} className="font-medium tabular-nums text-foreground" />
    </>
  );
}

interface DetailRow {
  label: string;
  value: ReactNode;
  valueClassName?: string;
  full?: boolean;
}

function HeartbeatBody({
  monitor,
  heartbeat,
}: {
  monitor: AdminMonitor;
  heartbeat: HeartbeatView;
}) {
  const { phase, startedSec, deadlineSec, nextDueSec, lastDurationSec, nowSec } = heartbeat;
  const isFail = heartbeat.lastResult === 'fail';

  const rows: DetailRow[] = [];

  if (phase === 'running') {
    if (startedSec !== undefined) {
      rows.push({
        label: 'Running for',
        value: formatDuration(Math.max(0, nowSec - startedSec) * 1000),
      });
    }
    if (deadlineSec !== undefined) {
      rows.push({ label: 'Must finish by', value: <UtcTime sec={deadlineSec} /> });
    }
  } else if (phase === 'late') {
    if (lastDurationSec !== undefined) {
      rows.push({
        label: 'Duration',
        value: formatDuration(lastDurationSec * 1000),
      });
    }
    if (deadlineSec !== undefined) {
      rows.push({
        label: 'Grace ends',
        value: <UtcTime sec={deadlineSec} />,
        valueClassName: 'text-status-degraded-text',
      });
    }
  } else if (phase === 'down' && isFail) {
    if (lastDurationSec !== undefined) {
      rows.push({
        label: 'Failed after',
        value: formatDuration(lastDurationSec * 1000),
        valueClassName: 'text-status-down-text',
      });
    }
    if (deadlineSec !== undefined) {
      rows.push({ label: 'Next due', value: <UtcTime sec={deadlineSec} /> });
    }
  } else if (phase === 'down') {
    if (lastDurationSec !== undefined) {
      rows.push({
        label: 'Duration',
        value: formatDuration(lastDurationSec * 1000),
      });
    }
    if (deadlineSec !== undefined) {
      rows.push({
        label: 'Overdue by',
        value: formatDuration(Math.max(0, nowSec - deadlineSec) * 1000),
        valueClassName: 'text-status-down-text',
      });
    }
  } else if (phase === 'up') {
    if (lastDurationSec !== undefined) {
      rows.push({
        label: 'Duration',
        value: formatDuration(lastDurationSec * 1000),
      });
    }

    const dueSec = nextDueSec ?? deadlineSec;
    if (dueSec !== undefined) {
      rows.push({ label: 'Next due', value: <UtcTime sec={dueSec} /> });
    }
  }

  if (heartbeat.message) {
    rows.push({
      label: 'Reported',
      value: heartbeat.message,
      valueClassName: 'text-status-down-text wrap-break-word',
      full: true,
    });
  }

  const runCount = (heartbeat.runs ?? []).length;

  return (
    <>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-medium text-muted-foreground">
          {runCount === 0 ? 'Runs' : `Last ${runCount} ${runCount === 1 ? 'run' : 'runs'}`}
        </h4>
        {monitor.periodSeconds !== undefined && (
          <span className="text-xs text-muted-foreground">
            {monitor.graceSeconds
              ? `Every ${formatCadence(monitor.periodSeconds)}, ${formatCadence(monitor.graceSeconds)} grace`
              : `Every ${formatCadence(monitor.periodSeconds)}`}
          </span>
        )}
      </div>

      <RunStrip
        heartbeat={heartbeat}
        periodSeconds={monitor.periodSeconds}
        graceSeconds={monitor.graceSeconds}
      />

      {rows.length > 0 ? (
        <dl className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1.5 text-xs">
          {rows.map((row) => (
            <div
              key={row.label}
              className={cn('flex basis-full items-baseline gap-1.5', !row.full && 'sm:basis-auto')}
            >
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd
                className={cn(
                  'text-foreground',
                  !row.full && 'font-medium tabular-nums',
                  row.valueClassName,
                )}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        phase === 'pending' && (
          <p className="mt-2.5 text-xs text-muted-foreground">
            No run recorded yet. The first ping starts the schedule.
          </p>
        )
      )}
    </>
  );
}

function triggerLabel({
  name,
  heartbeat,
  isUp,
  uptime,
}: {
  name: string;
  heartbeat: HeartbeatView | null;
  isUp: boolean;
  uptime: string;
}): string {
  if (!heartbeat) {
    const status = isUp ? 'operational' : 'not operational';
    return `${name}, ${status}, ${uptime}. Click to toggle details`;
  }

  const status = PHASE_STATUS_LABELS[heartbeat.phase];
  if (heartbeat.lastRunSec === undefined || heartbeat.deadlineSec === undefined) {
    return `${name}, ${status}, ${uptime}. Click to toggle details`;
  }

  return `${name}, ${status}, last run ${formatUtcShort(heartbeat.lastRunSec)}, next expected by ${formatUtcShort(heartbeat.deadlineSec)}. Click to toggle details`;
}

function MonitorSubLines({
  error,
  heartbeat,
  latency,
  isAdminView,
}: {
  error: string | null;
  heartbeat: HeartbeatView | null;
  latency: { ping: number; loc: string } | null;
  isAdminView: boolean;
}) {
  const lateDeadline = heartbeat?.phase === 'late' ? heartbeat.deadlineSec : undefined;
  const runningStart = heartbeat?.phase === 'running' ? heartbeat.startedSec : undefined;
  const reportedFailure = heartbeat?.phase === 'down' && heartbeat.lastResult === 'fail';
  const overdueDeadline =
    heartbeat?.phase === 'down' && heartbeat.lastResult !== 'fail'
      ? heartbeat.deadlineSec
      : undefined;

  return (
    <>
      {error && !reportedFailure && !(overdueDeadline !== undefined && !isAdminView) && (
        <p className="text-xs text-status-down-text line-clamp-2 wrap-break-word mt-0.5">{error}</p>
      )}
      {reportedFailure && (
        <p className="text-xs text-status-down-text line-clamp-2 wrap-break-word mt-0.5">
          Job reported failure
        </p>
      )}
      {overdueDeadline !== undefined && !isAdminView && (
        <p className="text-xs text-status-down-text mt-0.5">
          {`Overdue, was expected by ${formatUtcShort(overdueDeadline)}`}
        </p>
      )}
      {lateDeadline !== undefined && (
        <p className="text-xs text-status-degraded-text mt-0.5">
          Running late, expected by <UtcTime sec={lateDeadline} />
        </p>
      )}
      {runningStart !== undefined && (
        <p className="text-xs text-muted-foreground mt-0.5">
          Running since <UtcTime sec={runningStart} />
        </p>
      )}
      {heartbeat?.phase === 'pending' && (
        <p className="text-xs text-muted-foreground mt-0.5">Waiting for first ping</p>
      )}
      {heartbeat
        ? heartbeat.phase !== 'pending' && (
            <div className="@min-[641px]:hidden mt-1 text-xs text-muted-foreground">
              <HeartbeatMeta heartbeat={heartbeat} />
            </div>
          )
        : latency && (
            <div className="@min-[641px]:hidden mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{latency.ping}ms</span>
              <span>{latency.loc}</span>
            </div>
          )}
    </>
  );
}

function MonitorHeading({ monitor }: { monitor: AdminMonitor }) {
  return (
    <>
      {monitor.link ? (
        <a
          href={monitor.link}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative z-20 flex items-start gap-1.5 font-medium text-foreground min-w-0 hover:underline"
        >
          <span className="line-clamp-2 wrap-break-word sm:line-clamp-1">{monitor.name}</span>
          <IconExternalLink className="hidden sm:inline-flex h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </a>
      ) : (
        <h3 className="font-medium text-foreground min-w-0">
          <span className="line-clamp-2 wrap-break-word sm:line-clamp-1">{monitor.name}</span>
        </h3>
      )}
      {monitor.private && (
        <Badge variant="outline" className="shrink-0">
          <IconEyeOff className="size-3" aria-hidden="true" />
          Private
          <span className="sr-only">{`${monitor.name} is private and never appears on the public page`}</span>
        </Badge>
      )}
      {monitor.tooltip && (
        <Tooltip>
          <TooltipTrigger className="relative z-20 text-xs text-muted-foreground cursor-help">
            ⓘ
          </TooltipTrigger>
          <TooltipContent>{monitor.tooltip}</TooltipContent>
        </Tooltip>
      )}
    </>
  );
}

function LatencyMeta({
  isProxy,
  latency,
}: {
  isProxy?: boolean;
  latency: { ping: number; loc: string };
}) {
  const coloLabel = formatColoLabel(latency.loc);

  return (
    <div className="hidden @min-[641px]:flex items-center gap-1.5 text-right whitespace-nowrap">
      <span className="text-sm font-medium text-foreground">{latency.ping}ms</span>
      {isProxy ? (
        <span className="text-xs text-muted-foreground">{latency.loc}</span>
      ) : (
        <Tooltip>
          <TooltipTrigger className="relative z-20 text-xs text-muted-foreground cursor-help">
            {latency.loc}
          </TooltipTrigger>
          <TooltipContent>
            <div className="flex flex-col gap-1">
              <div className="font-medium">
                <span className="font-mono">{latency.loc}</span>
                {coloLabel && <span>{` — ${coloLabel}`}</span>}
              </div>
              <div className="opacity-80">
                Last check ran at this Cloudflare edge location (may differ from yours).
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export function MonitorCard({
  monitor,
  state,
  open,
  onOpenChange,
  pingUrlSlot,
  className,
  style,
}: MonitorCardProps) {
  const { isUp, uptimePercent, error, latency, statusColor } = useMonitorStatus(monitor.id, state);
  const heartbeat = deriveHeartbeat(monitor, state);

  const hasStarted = !!state.startedAt?.[monitor.id];
  const uptimeDisplay = formatUptimeDisplay(uptimePercent, hasStarted, 2);
  const errorLine = !isUp && error ? error : null;
  const isAdminView = pingUrlSlot !== undefined;

  const uptimeBadge = (
    <Badge
      variant="outline"
      className={cn(
        'font-mono',
        heartbeat ? PHASE_BADGE_CLASS[heartbeat.phase] : cn(statusColor.text, statusColor.border),
      )}
    >
      {uptimeDisplay}
    </Badge>
  );

  return (
    <Card className={cn('@container overflow-hidden p-0', className)} style={style}>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <div className="relative hover:bg-muted/50 transition-colors">
          <CollapsibleTrigger
            nativeButton={false}
            render={<div />}
            className="absolute inset-0 z-10"
            aria-label={triggerLabel({
              name: monitor.name,
              heartbeat,
              isUp,
              uptime: uptimeDisplay,
            })}
          />

          <div className="flex items-start gap-2.5 px-3 py-2">
            <div className="shrink-0 mt-0.5">
              <StatusIcon isUp={isUp} phase={heartbeat?.phase} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-start gap-x-2 gap-y-1 min-w-0">
                <MonitorHeading monitor={monitor} />
              </div>

              <MonitorSubLines
                error={errorLine}
                heartbeat={heartbeat}
                latency={latency}
                isAdminView={isAdminView}
              />
            </div>

            <div className="flex h-5 shrink-0 items-center gap-2.5">
              {heartbeat
                ? heartbeat.phase !== 'pending' && (
                    <div className="hidden @min-[641px]:block text-right text-xs whitespace-nowrap text-muted-foreground">
                      <HeartbeatMeta heartbeat={heartbeat} />
                    </div>
                  )
                : latency && <LatencyMeta isProxy={monitor.isProxy} latency={latency} />}

              {heartbeat ? (
                <Tooltip>
                  <TooltipTrigger className="relative z-20 cursor-help">
                    {uptimeBadge}
                  </TooltipTrigger>
                  <TooltipContent>
                    Uptime samples this monitor once a minute with the cron run, not once per job
                    run.
                  </TooltipContent>
                </Tooltip>
              ) : (
                uptimeBadge
              )}

              {pingUrlSlot && <div className="relative z-20 flex items-center">{pingUrlSlot}</div>}

              <IconChevronDown
                className={cn(
                  'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                  open && 'rotate-180',
                )}
              />
            </div>
          </div>
        </div>

        <CollapsibleContent>
          <div className="border-t border-border px-3 py-2 bg-muted/30">
            {heartbeat ? (
              <HeartbeatBody monitor={monitor} heartbeat={heartbeat} />
            ) : (
              <>
                <h4 className="mb-2 text-xs font-medium text-muted-foreground">
                  {`Last ${UPTIME_DAYS} days`}
                </h4>
                <StatusBar monitorId={monitor.id} monitorName={monitor.name} state={state} />
                {open && !monitor.hideLatencyChart && (
                  <div className="mt-4">
                    <h4 className="mb-2 text-xs font-medium text-muted-foreground">
                      Response times (ms)
                    </h4>
                    <LatencyChart monitor={monitor} state={state} />
                  </div>
                )}
              </>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

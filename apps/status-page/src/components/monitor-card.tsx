import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { IconExternalLink, IconChevronRight, IconEyeOff } from '@tabler/icons-react';
import type { HeartbeatStatus } from '@flarewatch/shared';
import { formatUtcShort } from '@flarewatch/shared';
import { UPTIME_DAYS } from '@/lib/constants';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusBar } from '@/components/status-bar';
import { RowBars, barsSummary } from '@/components/row-bars';
import { StatusIcon } from '@/components/status-icon';
import { RunStrip } from '@/components/run-strip';
import { CheckNow } from '@/components/check-now';
import { CopyPingUrlButton } from '@/components/copy-ping-url-button';
import { getHeartbeatPingUrl } from '@/lib/heartbeat-ping-url';
import type { LatencySample, Maintenance, StatusView } from '@flarewatch/shared';
import { useMonitorStatus } from '@/lib/hooks/use-monitor-status';
import type { AdminMonitor } from '@/lib/public-view';
import { deriveHeartbeat, type HeartbeatView } from '@/lib/heartbeat';
import { monitorState, type MonitorState } from '@/lib/monitor-state';
import { formatColoLabel } from '@/lib/cf-colos';
import { formatCadence, formatDuration } from '@/lib/date';
import { formatUptimeDisplay, generateDailyStatus } from '@/lib/uptime';
import { LatencyChart } from '@/components/latency-chart';
import { cn } from '@/lib/utils';

const PHASE_STATUS_LABELS: Record<HeartbeatStatus, string> = {
  up: 'operational',
  late: 'running late',
  pending: 'waiting for first ping',
  running: 'running',
  down: 'overdue',
};

const CHECK_STATUS_LABELS: Partial<Record<MonitorState, string>> = {
  down: 'not operational',
  degraded: 'responding slowly',
};

const STATE_BADGE_CLASS: Record<MonitorState, string> = {
  up: 'text-status-operational border-status-operational',
  running: 'text-status-operational border-status-operational',
  degraded: 'text-status-degraded-text border-status-degraded',
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
        <h2 className="text-xs font-medium text-muted-foreground">
          {runCount === 0 ? 'Runs' : `Last ${runCount} ${runCount === 1 ? 'run' : 'runs'}`}
        </h2>
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

function rowLabel({
  name,
  heartbeat,
  shown,
  uptime,
}: {
  name: string;
  heartbeat: HeartbeatView | null;
  shown: MonitorState;
  uptime: string;
}): string {
  if (!heartbeat) {
    const status = CHECK_STATUS_LABELS[shown] ?? 'operational';
    return `${name}, ${status}, ${uptime}`;
  }

  const status = PHASE_STATUS_LABELS[shown === 'down' ? 'down' : heartbeat.phase];
  if (heartbeat.lastRunSec === undefined || heartbeat.deadlineSec === undefined) {
    return `${name}, ${status}, ${uptime}`;
  }

  return `${name}, ${status}, last run ${formatUtcShort(heartbeat.lastRunSec)}, next expected by ${formatUtcShort(heartbeat.deadlineSec)}`;
}

function MonitorSubLines({
  error,
  heartbeat,
  latency,
  slowOverMs,
  operator,
}: {
  error: string | null;
  heartbeat: HeartbeatView | null;
  latency: { ping: number; loc: string } | null;
  slowOverMs: number | undefined;
  operator: boolean;
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
      {error && !reportedFailure && !(overdueDeadline !== undefined && !operator) && (
        <p className="text-xs text-status-down-text line-clamp-2 wrap-break-word mt-0.5">{error}</p>
      )}
      {reportedFailure && (
        <p className="text-xs text-status-down-text line-clamp-2 wrap-break-word mt-0.5">
          Job reported failure
        </p>
      )}
      {overdueDeadline !== undefined && !operator && (
        <p className="text-xs text-status-down-text mt-0.5">
          {`Overdue, was expected by ${formatUtcShort(overdueDeadline)}`}
        </p>
      )}
      {lateDeadline !== undefined && (
        <p className="text-xs text-status-degraded-text mt-0.5">
          Running late, expected by <UtcTime sec={lateDeadline} />
        </p>
      )}
      {slowOverMs !== undefined && (
        <p className="text-xs text-status-degraded-text mt-0.5">
          {`Slow response, over ${slowOverMs}ms`}
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
              <span className={cn('font-medium', latencyClass(slowOverMs))}>{latency.ping}ms</span>
              <span>{latency.loc}</span>
            </div>
          )}
    </>
  );
}

function MonitorHeading({ monitor, detail }: { monitor: AdminMonitor; detail: boolean }) {
  const Title = detail ? 'h1' : 'h3';
  return (
    <>
      <Title
        className={cn('min-w-0 font-medium text-foreground', detail && 'text-xl font-semibold')}
      >
        <span className={cn('wrap-break-word', !detail && 'line-clamp-2 sm:line-clamp-1')}>
          {monitor.name}
        </span>
      </Title>
      {detail && monitor.link && (
        <a
          href={monitor.link}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          Open site
          <IconExternalLink className="size-3.5" aria-hidden="true" />
          <span className="sr-only">(opens in new tab)</span>
        </a>
      )}
      {monitor.private && (
        <Badge variant="outline" className="shrink-0">
          <IconEyeOff className="size-3" aria-hidden="true" />
          Private
          <span className="sr-only">{`${monitor.name} is private: visitors never see it`}</span>
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

function latencyClass(slowOverMs: number | undefined): string {
  return slowOverMs === undefined ? 'text-foreground' : 'text-status-degraded-text';
}

function LatencyMeta({
  isProxy,
  latency,
  slowOverMs,
}: {
  isProxy?: boolean;
  latency: { ping: number; loc: string };
  slowOverMs: number | undefined;
}) {
  const coloLabel = formatColoLabel(latency.loc);

  return (
    <div className="hidden @min-[641px]:flex items-center gap-1.5 text-right whitespace-nowrap">
      <span className={cn('text-sm font-medium', latencyClass(slowOverMs))}>{latency.ping}ms</span>
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

interface MonitorViewProps {
  monitor: AdminMonitor;
  state: StatusView;
  maintenances: Maintenance[];
  operator?: boolean;
}

/**
 * Status icon, name, current state and uptime: the part the row and the detail
 * page share. In a row it also carries the link that covers the whole row.
 */
function MonitorSummary({
  monitor,
  state,
  maintenances,
  operator = false,
  detail,
  history,
}: MonitorViewProps & { detail: boolean; history?: string }) {
  const { uptimePercent, error, latency, statusColor } = useMonitorStatus(monitor.id, state);
  const shown = monitorState(monitor, state, maintenances);
  const heartbeat = deriveHeartbeat(monitor, state);
  const slowOverMs = !heartbeat && shown === 'degraded' ? monitor.maxLatencyMs : undefined;
  const hasStarted = state.monitors[monitor.id]?.startedAt !== undefined;
  const uptimeDisplay = formatUptimeDisplay(uptimePercent, hasStarted, 2);

  const uptimeBadge = (
    <Badge
      variant="outline"
      className={cn(
        'font-mono',
        heartbeat ? STATE_BADGE_CLASS[shown] : cn(statusColor.text, statusColor.border),
      )}
    >
      {uptimeDisplay}
    </Badge>
  );

  return (
    <div
      className="flex items-start gap-2.5"
      style={{ viewTransitionName: `monitor-${monitor.id.replace(/[^\w-]/g, '_')}` }}
    >
      {!detail && (
        <Link
          to="/monitors/$monitorId"
          params={{ monitorId: monitor.id }}
          className="absolute inset-0 z-10 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
          aria-label={`${rowLabel({ name: monitor.name, heartbeat, shown, uptime: uptimeDisplay })}, ${history}`}
        />
      )}
      <div className="shrink-0 mt-0.5">
        <StatusIcon state={shown} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          <MonitorHeading monitor={monitor} detail={detail} />
        </div>

        <MonitorSubLines
          error={shown === 'down' && error ? error : null}
          heartbeat={heartbeat}
          latency={latency}
          slowOverMs={slowOverMs}
          operator={operator}
        />
      </div>

      <div className="flex h-5 shrink-0 items-center gap-2.5">
        {heartbeat
          ? heartbeat.phase !== 'pending' && (
              <div className="hidden @min-[641px]:block text-right text-xs whitespace-nowrap text-muted-foreground">
                <HeartbeatMeta heartbeat={heartbeat} />
              </div>
            )
          : latency && (
              <LatencyMeta isProxy={monitor.isProxy} latency={latency} slowOverMs={slowOverMs} />
            )}

        {heartbeat ? (
          <Tooltip>
            <TooltipTrigger className="relative z-20 cursor-help">{uptimeBadge}</TooltipTrigger>
            <TooltipContent>
              Uptime samples this monitor once a minute with the cron run, not once per job run.
            </TooltipContent>
          </Tooltip>
        ) : (
          uptimeBadge
        )}

        {!detail && <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />}
      </div>
    </div>
  );
}

/** One line in the monitor list; the whole row opens the monitor's page. */
export function MonitorRow({ monitor, state, maintenances, operator }: MonitorViewProps) {
  const heartbeat = deriveHeartbeat(monitor, state);
  const days = generateDailyStatus(monitor.id, state);
  return (
    <div
      data-slot="monitor-row"
      className="@container relative px-3 py-2 transition-colors hover:bg-muted/50"
    >
      <MonitorSummary
        monitor={monitor}
        state={state}
        maintenances={maintenances}
        operator={operator}
        detail={false}
        history={barsSummary(days, heartbeat)}
      />
      <RowBars days={days} heartbeat={heartbeat} />
    </div>
  );
}

export function MonitorDetail({
  monitor,
  state,
  maintenances,
  latency = [],
  operator = false,
}: MonitorViewProps & { latency?: LatencySample[] }) {
  const heartbeat = deriveHeartbeat(monitor, state);

  return (
    <Card className="@container p-0">
      <div className="px-4 pt-4">
        <MonitorSummary
          monitor={monitor}
          state={state}
          maintenances={maintenances}
          operator={operator}
          detail
        />
        {operator && monitor.method === 'HEARTBEAT' && (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <CopyPingUrlButton
              monitorId={monitor.id}
              monitorName={monitor.name}
              loadPingUrl={(id) => getHeartbeatPingUrl({ data: { id } })}
            />
            Ping URL for your job
          </div>
        )}
        {operator && monitor.method !== 'HEARTBEAT' && (
          <CheckNow key={monitor.id} monitorId={monitor.id} />
        )}
      </div>

      <div className="border-t border-border px-4 py-3">
        {heartbeat ? (
          <HeartbeatBody monitor={monitor} heartbeat={heartbeat} />
        ) : (
          <>
            <h2 className="mb-2 text-xs font-medium text-muted-foreground">
              {`Last ${UPTIME_DAYS} days`}
            </h2>
            <StatusBar monitorId={monitor.id} monitorName={monitor.name} state={state} />
            {!monitor.hideLatencyChart && (
              <div className="mt-4">
                <h2 className="mb-2 text-xs font-medium text-muted-foreground">
                  Response times (ms)
                </h2>
                <LatencyChart samples={latency} />
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

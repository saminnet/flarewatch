import {
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { HeartbeatRun } from '@flarewatch/shared';
import { HEARTBEAT_RUN_HISTORY } from '@flarewatch/shared';
import { formatUtcShort } from '@flarewatch/shared';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDuration } from '@/lib/date';
import { runLatenessSec, type HeartbeatView } from '@/lib/heartbeat';
import { useContainerWidth } from '@/lib/hooks/use-container-width';
import { STATUS_BAR } from '@/lib/constants';
import { cn } from '@/lib/utils';

const CELL_CLASSES: Record<HeartbeatRun['outcome'], string> = {
  ok: 'bg-status-operational',
  late: 'bg-status-degraded',
  fail: 'bg-status-down',
  miss: 'bg-status-down/40 border border-dashed border-status-down',
};

const RUNNING_CELL_CLASSES = 'border border-status-maintenance';

const GROUP_FOCUS =
  'outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

const CELL_FEEDBACK = `transition-[scale,filter,box-shadow] duration-150 ease-out hover:scale-y-110 hover:brightness-110 ${GROUP_FOCUS}`;

type NextCellKind = 'next' | 'late' | 'missed' | 'first' | 'running';

const NEXT_CELL_CLASSES: Record<NextCellKind, string> = {
  next: 'bg-status-unknown-bg border-muted-foreground',
  late: 'bg-status-degraded/40 border-status-degraded-text',
  missed: 'bg-status-down/40 border-status-down',
  first: 'bg-status-unknown-bg border-muted-foreground',
  running: 'bg-status-maintenance/40 border-status-maintenance',
};

const NEXT_DETAIL_KEYS = {
  running: 'monitor.nextRunningMustFinishBy',
  late: 'monitor.nextLateGraceEnds',
  missed: 'monitor.nextMissedExpectedBy',
  next: 'monitor.nextRunExpectedBy',
} as const;

interface NextCellProps {
  kind: NextCellKind;
  detail: string;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** Tooltips never open on touch, so a tap opens the cell's detail explicitly. */
function CellTooltip({
  detail,
  ...props
}: ComponentProps<typeof TooltipTrigger> & { detail: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        tabIndex={-1}
        aria-label={detail}
        closeOnClick={false}
        onClick={() => setOpen(true)}
        {...props}
      />
      <TooltipContent side="top" className="text-xs">
        {detail}
      </TooltipContent>
    </Tooltip>
  );
}

function NextCell({ kind, detail, className, ref }: NextCellProps) {
  return (
    <CellTooltip
      ref={ref}
      detail={detail}
      className={cn(
        'h-6 rounded-sm border border-dashed',
        NEXT_CELL_CLASSES[kind],
        CELL_FEEDBACK,
        className,
      )}
    />
  );
}

function Rule() {
  return <div aria-hidden="true" className="mx-0.5 w-px flex-none self-stretch bg-border" />;
}

type Slot =
  | { kind: 'blank' }
  | { kind: 'run'; run: HeartbeatRun; index: number }
  | { kind: 'running' };

interface StripCellsProps {
  slots: Slot[];
  isMobile: boolean;
  nextKind: NextCellKind;
  nextDetail: string;
  summary: string;
  runDetail: (run: HeartbeatRun, index: number) => string;
  runningDetail: string;
  groupRef?: Ref<HTMLDivElement>;
}

function StripCells({
  slots,
  isMobile,
  nextKind,
  nextDetail,
  summary,
  runDetail,
  runningDetail,
  groupRef,
}: StripCellsProps) {
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const sizing = isMobile ? 'w-2.5 shrink-0' : 'min-w-0';

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const cells = cellRefs.current.filter((cell) => cell !== null);
    if (cells.length === 0) return;
    event.preventDefault();
    const last = cells.length - 1;
    const current = cells.findIndex((cell) => cell === document.activeElement);
    let next: number;
    if (event.key === 'ArrowLeft') next = current <= 0 ? last : current - 1;
    else if (event.key === 'ArrowRight') next = current === last ? 0 : current + 1;
    else if (event.key === 'Home') next = 0;
    else next = last;
    cells[next]?.focus();
  }

  return (
    <div
      className={cn('w-full items-center gap-0.5', isMobile ? 'flex' : 'grid')}
      onKeyDown={handleKeyDown}
      style={
        isMobile
          ? undefined
          : { gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr)) auto minmax(0, 1fr)` }
      }
    >
      <div
        ref={groupRef}
        role="group"
        tabIndex={0}
        aria-label={summary}
        style={isMobile ? undefined : { gridColumn: `span ${slots.length}` }}
        className={cn(
          'min-w-0 items-center gap-0.5 overflow-hidden rounded',
          GROUP_FOCUS,
          isMobile ? 'flex flex-1' : 'grid grid-cols-subgrid',
        )}
      >
        {slots.map((slot, position) => {
          if (slot.kind === 'blank') {
            return (
              <span
                key={position}
                aria-hidden="true"
                className={cn('h-6 rounded-sm bg-status-unknown-bg', sizing)}
              />
            );
          }
          const detail = slot.kind === 'run' ? runDetail(slot.run, slot.index) : runningDetail;
          return (
            <CellTooltip
              key={position}
              detail={detail}
              ref={(el) => {
                cellRefs.current[position] = el;
              }}
              style={
                slot.kind === 'running'
                  ? {
                      background:
                        'linear-gradient(to top, var(--status-maintenance) 45%, var(--status-maintenance-bg) 45%)',
                    }
                  : undefined
              }
              className={cn(
                'h-6 rounded-sm',
                sizing,
                slot.kind === 'run' ? CELL_CLASSES[slot.run.outcome] : RUNNING_CELL_CLASSES,
                CELL_FEEDBACK,
              )}
            />
          );
        })}
      </div>
      <Rule />
      <NextCell
        kind={nextKind}
        detail={nextDetail}
        className={sizing}
        ref={(el) => {
          cellRefs.current[slots.length] = el;
        }}
      />
    </div>
  );
}

export function RunStrip({
  heartbeat,
  periodSeconds,
  graceSeconds,
}: {
  heartbeat: HeartbeatView;
  periodSeconds?: number;
  graceSeconds?: number;
}) {
  const { t } = useTranslation();
  const { ref, width, isReady } = useContainerWidth();

  const runs = heartbeat.runs ?? [];
  const running = heartbeat.phase === 'running';

  const missed = runs.filter((run) => run.outcome === 'miss').length;
  const failed = runs.filter((run) => run.outcome === 'fail').length;
  const lastRun = runs[runs.length - 1];
  const lastRunSec = lastRun ? lastRun.at : heartbeat.lastRunSec;
  const runningDetail = t('monitor.runRunningSince', {
    time: formatUtcShort(heartbeat.startedSec ?? heartbeat.nowSec),
  });
  const summary =
    lastRunSec !== undefined
      ? t('monitor.runStripLabel', {
          count: runs.length,
          missed,
          failed,
          time: formatUtcShort(lastRunSec),
        })
      : running
        ? runningDetail
        : t('monitor.noRunsYet');

  function runDetail(run: HeartbeatRun, index: number): string {
    const time = formatUtcShort(run.at);
    if (run.outcome === 'late') {
      const lateBySec = runLatenessSec(runs, index, periodSeconds, graceSeconds);
      if (lateBySec > 0) {
        return t('monitor.runReceivedLate', { duration: formatDuration(lateBySec * 1000) });
      }
      return t('monitor.runCompletedLateAt', { time });
    }
    if (run.outcome === 'fail') return t('monitor.runFailedAt', { time });
    if (run.outcome === 'miss') return t('monitor.runMissedAt', { time });
    return t('monitor.runCompletedAt', { time });
  }

  const nextKind: NextCellKind =
    heartbeat.phase === 'pending'
      ? 'first'
      : heartbeat.phase === 'running'
        ? 'running'
        : heartbeat.phase === 'late'
          ? 'late'
          : heartbeat.phase === 'down' && heartbeat.lastResult !== 'fail'
            ? 'missed'
            : 'next';

  const nextTimeSec = heartbeat.nextDueSec ?? heartbeat.deadlineSec;
  const nextDetail =
    nextKind === 'first'
      ? t('monitor.waitingFirstPingBody')
      : nextTimeSec === undefined
        ? t('monitor.nextRunUnscheduled')
        : t(NEXT_DETAIL_KEYS[nextKind], { time: formatUtcShort(nextTimeSec) });

  const filled: Slot[] = runs.map((run, index) => ({ kind: 'run', run, index }));
  if (running) filled.push({ kind: 'running' });
  const slots: Slot[] = [
    ...Array.from({ length: HEARTBEAT_RUN_HISTORY - filled.length }, (): Slot => ({
      kind: 'blank',
    })),
    ...filled,
  ];
  const mobileCount = isReady
    ? Math.min(Math.floor(width / STATUS_BAR.MOBILE_BAR_WIDTH), slots.length)
    : 0;

  const cells = { nextKind, nextDetail, summary, runDetail, runningDetail };

  return (
    <>
      <div className="hidden sm:flex">
        <StripCells slots={slots} isMobile={false} {...cells} />
      </div>
      <div className="flex sm:hidden">
        <StripCells
          slots={mobileCount > 0 ? slots.slice(-mobileCount) : []}
          isMobile={true}
          groupRef={ref}
          {...cells}
        />
      </div>
    </>
  );
}

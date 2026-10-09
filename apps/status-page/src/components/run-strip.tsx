import {
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from 'react';
import type { HeartbeatRun } from '@flarewatch/shared';
import { HEARTBEAT_RUN_HISTORY } from '@flarewatch/shared';
import { formatUtcShort } from '@flarewatch/shared';
import { Tooltip, TooltipContent } from '@/components/ui/tooltip';
import { RunCell } from '@/components/ui/status-cell';
import { formatDuration } from '@/lib/date';
import { runLatenessSec, type HeartbeatView } from '@/lib/heartbeat';
import { useContainerWidth } from '@/lib/hooks/use-container-width';
import { STATUS_BAR } from '@/lib/constants';
import { cn } from '@/lib/utils';

const GROUP_FOCUS =
  'outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3';

type NextCellKind = 'next' | 'late' | 'missed' | 'first' | 'running';

const NEXT_DETAIL: Record<'running' | 'late' | 'missed' | 'next', (time: string) => string> = {
  running: (time) => `Running, must finish by ${time}`,
  late: (time) => `Late, grace ends ${time}`,
  missed: (time) => `Missed, was expected by ${time}`,
  next: (time) => `Next run expected by ${time}`,
};

interface NextCellProps {
  kind: NextCellKind;
  detail: string;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** Tooltips never open on touch, so a tap opens the cell's detail explicitly. */
function CellTooltip({ detail, ...props }: ComponentProps<typeof RunCell> & { detail: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <RunCell
        tabIndex={-1}
        aria-label={detail}
        closeOnClick={false}
        onClick={() => setOpen(true)}
        {...props}
      />
      <TooltipContent side="top">{detail}</TooltipContent>
    </Tooltip>
  );
}

function NextCell({ kind, detail, className, ref }: NextCellProps) {
  return <CellTooltip ref={ref} detail={detail} next={kind} className={cn('h-6', className)} />;
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
      className={cn(
        'w-full items-center gap-0.5',
        isMobile
          ? 'flex'
          : 'grid grid-cols-[repeat(var(--cells),minmax(0,1fr))_auto_minmax(0,1fr)]',
      )}
      onKeyDown={handleKeyDown}
      style={isMobile ? undefined : { '--cells': slots.length }}
    >
      <div
        ref={groupRef}
        role="group"
        tabIndex={0}
        aria-label={summary}
        className={cn(
          'min-w-0 items-center gap-0.5 overflow-hidden rounded',
          GROUP_FOCUS,
          isMobile ? 'flex flex-1' : 'grid grid-cols-subgrid col-[span_var(--cells)]',
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
              run={slot.kind === 'run' ? slot.run.outcome : 'running'}
              className={cn('h-6', sizing)}
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

function runDetail(
  run: HeartbeatRun,
  index: number,
  runs: HeartbeatRun[],
  periodSeconds: number | undefined,
  graceSeconds: number | undefined,
): string {
  const time = formatUtcShort(run.at);
  if (run.outcome === 'late') {
    const lateBySec = runLatenessSec(runs, index, periodSeconds, graceSeconds);
    if (lateBySec > 0) {
      return `Received ${formatDuration(lateBySec * 1000)} late`;
    }
    return `Completed late at ${time}`;
  }
  if (run.outcome === 'fail') return `Failed at ${time}`;
  if (run.outcome === 'miss') return `Missed, expected ${time}`;
  return `Completed at ${time}`;
}

function nextCell(heartbeat: HeartbeatView) {
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
      ? 'Waiting for the first ping'
      : nextTimeSec === undefined
        ? 'Next run not scheduled yet'
        : NEXT_DETAIL[nextKind](formatUtcShort(nextTimeSec));

  return { nextKind, nextDetail };
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
  const { ref, width, isReady } = useContainerWidth();

  const runs = heartbeat.runs ?? [];
  const running = heartbeat.phase === 'running';

  const missed = runs.filter((run) => run.outcome === 'miss').length;
  const failed = runs.filter((run) => run.outcome === 'fail').length;
  const lastRun = runs[runs.length - 1];
  const lastRunSec = lastRun ? lastRun.at : heartbeat.lastRunSec;
  const runningDetail = `Running since ${formatUtcShort(heartbeat.startedSec ?? heartbeat.nowSec)}`;
  const summary =
    lastRunSec !== undefined
      ? `${runs.length} runs, ${missed} missed, ${failed} failed, last run ${formatUtcShort(lastRunSec)}`
      : running
        ? runningDetail
        : 'No run recorded yet. The first ping starts the schedule.';

  const { nextKind, nextDetail } = nextCell(heartbeat);

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

  const cells = {
    nextKind,
    nextDetail,
    summary,
    runningDetail,
    runDetail: (run: HeartbeatRun, index: number) =>
      runDetail(run, index, runs, periodSeconds, graceSeconds),
  };

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

import type { HeartbeatRun } from '@flarewatch/shared';
import { HEARTBEAT_RUN_HISTORY } from '@flarewatch/shared';
import { RUN_CELL_CLASSES, RUNNING_CELL_CLASSES } from '@/components/run-strip';
import type { HeartbeatView } from '@/lib/heartbeat';
import { STATUS_DOT_COLORS } from '@/lib/constants';
import type { DailyStatusData } from '@/lib/uptime';
import { cn } from '@/lib/utils';

/** Cells shown in a narrow row: the last 30 of the 90. */
const NARROW_CELLS = 30;

type Cell = { key: string; className: string };

/**
 * Display-only strip for a dashboard row: the row itself is the link, so cells
 * are not interactive. Narrow rows hide the older cells with a container query,
 * which keeps server and browser output identical.
 */
function Cells({ cells }: { cells: Cell[] }) {
  const hideFrom = cells.length - NARROW_CELLS;
  return (
    <div
      aria-hidden="true"
      data-slot="row-bars"
      className="mt-1.5 mr-6.5 mb-0.5 ml-7.5 flex h-4 items-stretch gap-0.5"
    >
      {cells.map((cell, index) => (
        <span
          key={cell.key}
          className={cn(
            'min-w-0 flex-1 rounded-[2px]',
            index < hideFrom && '@max-[641px]:hidden',
            cell.className,
          )}
        />
      ))}
    </div>
  );
}

export function RowBars({
  days,
  heartbeat,
}: {
  days: DailyStatusData[];
  heartbeat: HeartbeatView | null;
}) {
  if (!heartbeat) {
    const cells = days.map((day) => ({
      key: day.date.toISOString(),
      className: STATUS_DOT_COLORS[day.status],
    }));
    return <Cells cells={cells} />;
  }
  // 90 grey cells say nothing about a job that has not run yet.
  if (heartbeat.phase === 'pending') return null;
  const filled: Cell[] = (heartbeat.runs ?? []).map((run) => ({
    key: `${run.at}-${run.outcome}`,
    className: RUN_CELL_CLASSES[run.outcome],
  }));
  if (heartbeat.phase === 'running') {
    filled.push({ key: 'running', className: RUNNING_CELL_CLASSES });
  }
  const blanks = Array.from(
    { length: Math.max(0, HEARTBEAT_RUN_HISTORY - filled.length) },
    (_, index): Cell => ({ key: `blank-${index}`, className: 'bg-status-unknown-bg' }),
  );
  return <Cells cells={[...blanks, ...filled]} />;
}

/** Screen-reader text for the row link, since the strip itself is hidden from assistive tech. */
export function barsSummary(days: DailyStatusData[], heartbeat: HeartbeatView | null): string {
  if (heartbeat) {
    const runs = heartbeat.runs ?? [];
    if (runs.length === 0) return 'no runs yet';
    const count = (outcome: HeartbeatRun['outcome']) =>
      runs.filter((run) => run.outcome === outcome).length;
    return `last ${runs.length} runs: ${count('miss')} missed, ${count('fail')} failed, ${count('late')} late`;
  }
  const watched = days.filter((day) => day.status !== 'unknown');
  if (watched.length === 0) return 'no data yet';
  const span = `the last ${watched.length} ${watched.length === 1 ? 'day' : 'days'}`;
  const bad = watched.filter((day) => day.status !== 'up').length;
  return bad === 0 ? `no downtime in ${span}` : `downtime on ${bad} of ${span}`;
}

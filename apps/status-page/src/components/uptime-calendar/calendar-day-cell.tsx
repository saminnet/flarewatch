import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatUtc, type CalendarDay } from '@/lib/date';
import type { AggregatedDayData, DayStatus } from '@/lib/uptime';
import { STATUS_COLORS } from '@/lib/constants';

// Overlays are tuned for contrast on the solid status fills.
const DAY_TEXT_COLORS = {
  up: 'text-background/70',
  down: 'text-background/80',
  partial: 'text-status-degraded-text/50 dark:text-foreground/70',
  unknown: 'text-muted-foreground',
} satisfies Record<DayStatus, string>;

interface CalendarDayCellProps {
  day: CalendarDay | null;
  data: AggregatedDayData | undefined;
  animationDelay: number;
  onClick: (data: AggregatedDayData) => void;
}

export function CalendarDayCell({ day, data, animationDelay, onClick }: CalendarDayCellProps) {
  if (!day) {
    return <div className="h-6" />;
  }

  const dayNum = day.date.getUTCDate();

  if (day.isFuture) {
    return (
      <div
        className="h-6 rounded flex items-center justify-center bg-muted/40 text-[10px] leading-none tabular-nums text-muted-foreground/40 select-none"
        aria-hidden
      >
        {dayNum}
      </div>
    );
  }

  const status = data?.status ?? 'unknown';
  const dateStr = formatUtc(day.date, 'MMM d, yyyy');
  const incidentCount = data?.incidents.length ?? 0;
  const hasIncidents = incidentCount > 0;

  const label =
    data?.uptime != null
      ? `${data.uptime.toFixed(2)}% uptime on ${dateStr}`
      : `No data for ${dateStr}`;

  const cellClasses = cn(
    'relative h-6 rounded flex items-center justify-center',
    'text-[10px] leading-none tabular-nums font-medium select-none',
    'animate-calendar-cell transition-all duration-150',
    'hover:brightness-110',
    STATUS_COLORS[status],
    DAY_TEXT_COLORS[status],
    hasIncidents ? 'cursor-pointer hover:z-10' : 'cursor-default',
    day.isToday && 'ring-2 ring-foreground/40 ring-offset-1 ring-offset-background',
  );

  const sharedProps = {
    'aria-label': label,
    className: cellClasses,
    style: { animationDelay: `${animationDelay}ms` },
  } as const;

  const contents = (
    <>
      {dayNum}
      {hasIncidents && (
        <span
          className="absolute right-1 top-1 size-1.5 rounded-full bg-muted-foreground ring-1 ring-background/90"
          aria-hidden
        />
      )}
    </>
  );

  const cell =
    data && hasIncidents ? (
      <TooltipTrigger {...sharedProps} onClick={() => onClick(data)}>
        {contents}
      </TooltipTrigger>
    ) : (
      <TooltipTrigger {...sharedProps} render={<span />}>
        {contents}
      </TooltipTrigger>
    );

  return (
    <Tooltip>
      {cell}
      <TooltipContent side="top" className="text-xs">
        <div className="font-medium">{label}</div>
        {hasIncidents && (
          <div className="text-muted-foreground">
            {`${incidentCount} ${incidentCount === 1 ? 'incident' : 'incidents'}`}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

import { Tooltip, TooltipContent } from '@/components/ui/tooltip';
import { DayCell } from '@/components/ui/status-cell';
import { cn } from '@/lib/utils';
import { formatUtc, type CalendarDay } from '@/lib/date';
import { formatPercent, type AggregatedDayData } from '@/lib/uptime';

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
        className="h-6 rounded flex items-center justify-center bg-muted/40 text-2xs leading-none tabular-nums text-muted-foreground/40 select-none"
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
      ? `${formatPercent(data.uptime, 2)} uptime on ${dateStr}`
      : `No data for ${dateStr}`;

  const sharedProps = {
    'aria-label': label,
    status,
    today: day.isToday,
    className: cn(
      'relative h-6 flex items-center justify-center select-none',
      hasIncidents ? 'cursor-pointer hover:z-10' : 'cursor-default',
    ),
    style: { '--cell-delay': `${animationDelay}ms` },
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
      <DayCell {...sharedProps} onClick={() => onClick(data)}>
        {contents}
      </DayCell>
    ) : (
      <DayCell {...sharedProps} render={<span />}>
        {contents}
      </DayCell>
    );

  return (
    <Tooltip>
      {cell}
      <TooltipContent side="top">
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

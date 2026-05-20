import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatUtc, type CalendarDay } from '@/lib/date';
import type { AggregatedDayData, DayStatus } from '@/lib/uptime';
import { STATUS_COLORS } from '@/lib/constants';

const DAY_TEXT_COLORS: Record<DayStatus, string> = {
  up: 'text-white/70',
  down: 'text-white/80',
  partial: 'text-amber-900/50 dark:text-white/70',
  unknown: 'text-neutral-400 dark:text-neutral-500',
};

interface CalendarDayCellProps {
  day: CalendarDay | null;
  data: AggregatedDayData | undefined;
  animationDelay: number;
  onClick: (data: AggregatedDayData) => void;
}

export function CalendarDayCell({ day, data, animationDelay, onClick }: CalendarDayCellProps) {
  const { t } = useTranslation();

  // Padding cell (outside the month)
  if (!day) {
    return <div className="h-6" />;
  }

  const dayNum = day.date.getUTCDate();

  // Future day — faint placeholder with number
  if (day.isFuture) {
    return (
      <div
        className="h-6 rounded flex items-center justify-center bg-neutral-100 dark:bg-neutral-800/40 text-[10px] leading-none tabular-nums text-neutral-300 dark:text-neutral-600 select-none"
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
      ? t('calendar.uptimeAt', { percent: data.uptime.toFixed(2), date: dateStr })
      : t('calendar.noDataAt', { date: dateStr });

  const cellClasses = cn(
    'relative h-6 rounded flex items-center justify-center',
    'text-[10px] leading-none tabular-nums font-medium select-none',
    'animate-calendar-cell transition-all duration-150',
    'hover:brightness-110',
    STATUS_COLORS[status],
    DAY_TEXT_COLORS[status],
    hasIncidents ? 'cursor-pointer hover:z-10' : 'cursor-default',
    day.isToday && 'ring-[1.5px] ring-foreground/40 ring-offset-1 ring-offset-background',
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
          className="absolute right-1 top-1 size-1.5 rounded-full bg-sky-600 ring-1 ring-white/90 dark:ring-neutral-950"
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
          <div className="text-neutral-400">
            {t('calendar.incidentCount', { count: incidentCount })}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

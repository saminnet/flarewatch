import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getDateKey, type CalendarMonthGrid } from '@/lib/date';
import type { AggregatedDayData } from '@/lib/uptime';
import { CalendarDayCell } from './calendar-day-cell';

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

interface CalendarMonthProps {
  grid: CalendarMonthGrid;
  dataMap: Map<string, AggregatedDayData>;
  monthIndex: number;
  monthUptime: number | null;
  onDayClick: (data: AggregatedDayData) => void;
}

export function CalendarMonth({
  grid,
  dataMap,
  monthIndex,
  monthUptime,
  onDayClick,
}: CalendarMonthProps) {
  const { t } = useTranslation();
  const weekdays = useMemo(() => (t('calendar.weekdays') as string).split(','), [t]);

  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="text-xs font-semibold tracking-tight text-foreground">{grid.label}</div>
        {monthUptime != null && (
          <div className="text-xs font-medium text-muted-foreground tabular-nums">
            {monthUptime.toFixed(2)}%
          </div>
        )}
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-0.5">
        {weekdays.map((day, i) => (
          <div
            key={WEEKDAY_KEYS[i]}
            className="h-4 flex items-center justify-center text-[9px] font-medium text-muted-foreground/50 select-none"
          >
            {day}
          </div>
        ))}
      </div>
      <div className="grid gap-0.5">
        {grid.weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="grid grid-cols-7 gap-0.5">
            {week.map((day, dayIndex) => (
              <CalendarDayCell
                key={day ? day.date.toISOString() : `pad-${weekIndex}-${dayIndex}`}
                day={day}
                data={day ? dataMap.get(getDateKey(day.date)) : undefined}
                animationDelay={(monthIndex * 42 + weekIndex * 7 + dayIndex) * 8}
                onClick={onDayClick}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import type { PublicMonitor } from '@/lib/monitors';
import type { MonitorState } from '@flarewatch/shared';
import { generateAggregateDailyStatus, type AggregatedDayData } from '@/lib/uptime';
import { generateCalendarGrids, getDateKey } from '@/lib/date';
import { CalendarMonth } from './calendar-month';
import { CalendarDayModal } from './calendar-day-modal';
import { CalendarLegend } from './calendar-legend';

const MONTHS_PER_PAGE = 3;

interface UptimeCalendarProps {
  monitors: PublicMonitor[];
  state: MonitorState;
  /** The month to end the calendar window at (yyyy-MM). Defaults to the current month. */
  selectedMonth?: string;
}

export function UptimeCalendar({ monitors, state, selectedMonth }: UptimeCalendarProps) {
  const { t } = useTranslation();
  const [selectedDay, setSelectedDay] = useState<AggregatedDayData | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const aggregatedDays = useMemo(() => {
    const ids = monitors.map((m) => m.id);
    const nameMap = new Map(monitors.map((m) => [m.id, m.name]));
    return generateAggregateDailyStatus(ids, nameMap, state);
  }, [monitors, state]);

  // Snap to UTC day boundary so refetches within the same day don't recompute grids
  const dayMs = useMemo(() => {
    if (state.lastUpdate <= 0) return Date.UTC(2000, 0, 1);
    const d = new Date(state.lastUpdate * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }, [state.lastUpdate]);

  const calendarGrids = useMemo(
    () => generateCalendarGrids(new Date(dayMs), MONTHS_PER_PAGE, selectedMonth),
    [dayMs, selectedMonth],
  );

  const dataMap = useMemo(
    () => new Map(aggregatedDays.map((day) => [getDateKey(day.date), day])),
    [aggregatedDays],
  );

  // Per-month uptime: average of daily uptimes for days with data
  const monthUptimes = useMemo(() => {
    const result = new Map<string, number | null>();
    for (const grid of calendarGrids) {
      let sum = 0;
      let count = 0;
      for (const week of grid.weeks) {
        for (const day of week) {
          if (!day) continue;
          const data = dataMap.get(getDateKey(day.date));
          if (data && data.status !== 'unknown' && data.uptime != null) {
            sum += data.uptime;
            count++;
          }
        }
      }
      result.set(grid.yearMonth, count > 0 ? sum / count : null);
    }
    return result;
  }, [calendarGrids, dataMap]);

  const dateRangeLabel = useMemo(() => {
    const first = calendarGrids[0];
    const last = calendarGrids[calendarGrids.length - 1];
    if (!first || !last) return '';
    return `${first.label} — ${last.label}`;
  }, [calendarGrids]);

  function handleDayClick(data: AggregatedDayData) {
    setSelectedDay(data);
    setModalOpen(true);
  }

  const monthCards = calendarGrids.map((grid, i) => (
    <CalendarMonth
      key={grid.yearMonth}
      grid={grid}
      dataMap={dataMap}
      monthIndex={i}
      monthUptime={monthUptimes.get(grid.yearMonth) ?? null}
      onDayClick={handleDayClick}
    />
  ));

  return (
    <>
      <Card className="py-0 gap-0 mb-6">
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-semibold text-foreground">{t('calendar.title')}</div>
            <span className="text-xs text-muted-foreground">{dateRangeLabel}</span>
          </div>

          <div className="hidden sm:grid sm:grid-cols-3 gap-4">{monthCards}</div>
          <div className="flex sm:hidden flex-col-reverse gap-4">{monthCards}</div>

          <CalendarLegend />
        </div>
      </Card>

      <CalendarDayModal data={selectedDay} open={modalOpen} onOpenChange={setModalOpen} />
    </>
  );
}

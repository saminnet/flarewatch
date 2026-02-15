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

  // Use state.lastUpdate as the stable time source for SSR hydration safety.
  // When lastUpdate is 0 (no data yet), the parent guards rendering, but we
  // fall back to epoch to avoid Date.now() which differs between server/client.
  const nowMs = state.lastUpdate > 0 ? state.lastUpdate * 1000 : 0;

  // Stabilize to day precision so refetches within the same day don't recompute grids
  const todayKey = nowMs > 0 ? new Date(nowMs).toISOString().slice(0, 10) : '';

  const calendarGrids = useMemo(
    () =>
      generateCalendarGrids(
        new Date(nowMs || Date.UTC(2000, 0, 1)),
        MONTHS_PER_PAGE,
        selectedMonth,
      ),
    [todayKey, selectedMonth],
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

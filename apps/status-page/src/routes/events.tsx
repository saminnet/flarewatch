import { useMemo } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { IconChevronLeft, IconChevronRight, IconCalendar } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { MonthPicker } from '@/components/ui/month-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { UptimeCalendar } from '@/components/uptime-calendar/uptime-calendar';
import { IncidentCard } from '@/components/events/incident-card';
import { MaintenanceEventCard } from '@/components/events/maintenance-event-card';
import type { IncidentEvent, MaintenanceEvent, TimelineEvent } from '@/components/events/types';
import type { PublicMonitor } from '@/lib/monitors';
import { publicMonitorsQuery, monitorStateQuery } from '@/lib/query/monitors.queries';
import { useNow } from '@/lib/hooks/use-now';
import { getMaintenances } from '@/lib/kv';
import { getMaintenanceStatus } from '@/lib/maintenance';
import { isValidYearMonth, shiftYearMonth, getUtcMonthBounds } from '@/lib/date';
import type { Maintenance, MonitorState } from '@flarewatch/shared';
import { PAGE_CONTAINER_CLASSES } from '@/lib/constants';

interface EventsSearch {
  month?: string;
  monitor?: string;
  type?: 'all' | 'incident' | 'maintenance';
}

function getCurrentMonth(): string {
  // Use UTC to avoid server/client timezone hydration mismatches.
  return new Date().toISOString().slice(0, 7);
}

export const Route = createFileRoute('/events')({
  validateSearch: (search: Record<string, unknown>): EventsSearch => {
    const month = isValidYearMonth(search.month) ? search.month : getCurrentMonth();
    const monitor =
      typeof search.monitor === 'string' && search.monitor.length > 0 ? search.monitor : undefined;
    const type = search.type === 'incident' || search.type === 'maintenance' ? search.type : 'all';
    return { month, monitor, type };
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(publicMonitorsQuery());
    const maintenances = await getMaintenances();

    const loaderNowMs = Date.now();
    return { maintenances, loaderNowMs };
  },
  component: EventsPage,
});

function extractIncidentsFromState(
  state: MonitorState | null,
  monitors: PublicMonitor[],
  monthStart: Date,
  monthEnd: Date,
): IncidentEvent[] {
  if (!state) return [];

  const events: IncidentEvent[] = [];
  const monthStartSec = Math.floor(monthStart.getTime() / 1000);
  const monthEndSec = Math.floor(monthEnd.getTime() / 1000);
  const nowSec = state.lastUpdate > 0 ? state.lastUpdate : Math.floor(Date.now() / 1000);

  for (const monitor of monitors) {
    const incidents = state.incident[monitor.id];
    if (!incidents) continue;

    for (const incident of incidents) {
      const startTime = incident.start[0];
      if (startTime === undefined) continue;

      const endTime = incident.end;

      // Check if incident overlaps with the selected month
      const incidentStart = startTime;
      const incidentEnd = endTime ?? nowSec;

      if (incidentEnd < monthStartSec || incidentStart > monthEndSec) {
        continue; // Doesn't overlap with month
      }

      events.push({
        type: 'incident',
        monitorId: monitor.id,
        monitorName: monitor.name,
        start: startTime,
        end: endTime,
        errors: incident.error,
      });
    }
  }

  return events;
}

function extractMaintenanceEvents(
  maintenances: Maintenance[],
  monthStart: Date,
  monthEnd: Date,
): MaintenanceEvent[] {
  return maintenances
    .filter((m) => {
      const start = new Date(m.start);
      const end = m.end ? new Date(m.end) : null;

      // Check if maintenance overlaps with month
      const startTime = start.getTime();
      const endTime = end?.getTime() ?? Infinity;

      return endTime >= monthStart.getTime() && startTime <= monthEnd.getTime();
    })
    .map((m) => ({ type: 'maintenance' as const, maintenance: m }));
}

function EventsPage() {
  const { t } = useTranslation();
  const { data: monitors } = useSuspenseQuery(publicMonitorsQuery());
  const { data: state } = useSuspenseQuery(monitorStateQuery());
  const { maintenances, loaderNowMs } = Route.useLoaderData();
  const nowMs = useNow({ serverTime: loaderNowMs });
  const { month: selectedMonth, monitor: selectedMonitor, type: eventType } = Route.useSearch();
  const navigate = Route.useNavigate();
  const resolvedMonth = selectedMonth ?? getCurrentMonth();

  const { monthStart, monthEnd } = useMemo(() => getUtcMonthBounds(resolvedMonth), [resolvedMonth]);

  const { pinned, timeline } = useMemo(() => {
    const incidentEvents = extractIncidentsFromState(state, monitors, monthStart, monthEnd);
    const maintenanceEvents = extractMaintenanceEvents(maintenances, monthStart, monthEnd);
    let events: TimelineEvent[] = [...incidentEvents, ...maintenanceEvents];

    // Filter by event type
    if (eventType === 'incident') {
      events = events.filter((e) => e.type === 'incident');
    } else if (eventType === 'maintenance') {
      events = events.filter((e) => e.type === 'maintenance');
    }

    // Filter by monitor
    if (selectedMonitor) {
      events = events.filter((e) => {
        if (e.type === 'incident') {
          return e.monitorId === selectedMonitor;
        } else {
          return e.maintenance.monitors?.includes(selectedMonitor) ?? false;
        }
      });
    }

    // Sort by start date (newest first)
    const sortedEvents = events.sort((a, b) => {
      const aStart =
        a.type === 'incident' ? a.start * 1000 : new Date(a.maintenance.start).getTime();
      const bStart =
        b.type === 'incident' ? b.start * 1000 : new Date(b.maintenance.start).getTime();
      return bStart - aStart;
    });

    // Only pin when showing all event types
    if (eventType !== 'all') {
      return { pinned: [] as MaintenanceEvent[], timeline: sortedEvents };
    }

    const pinned: MaintenanceEvent[] = [];
    const timeline: TimelineEvent[] = [];

    for (const event of sortedEvents) {
      if (event.type === 'maintenance') {
        const status = getMaintenanceStatus(event.maintenance, nowMs);
        if (status === 'active' || status === 'upcoming') {
          pinned.push(event);
          continue;
        }
      }
      timeline.push(event);
    }

    return { pinned, timeline };
  }, [state, monitors, monthStart, monthEnd, maintenances, eventType, selectedMonitor, nowMs]);

  const { prevMonth, nextMonth } = useMemo(
    () => ({
      prevMonth: shiftYearMonth(resolvedMonth, -1),
      nextMonth: shiftYearMonth(resolvedMonth, 1),
    }),
    [resolvedMonth],
  );

  const monitorOptions = useMemo(
    () => [
      { value: '', label: t('filter.all') },
      ...monitors.map((m) => ({ value: m.id, label: m.name })),
    ],
    [monitors, t],
  );

  const typeOptions = useMemo(
    () => [
      { value: 'all', label: t('filter.allEvents') },
      { value: 'incident', label: t('filter.incidents') },
      { value: 'maintenance', label: t('filter.maintenances') },
    ],
    [t],
  );

  return (
    <div className={PAGE_CONTAINER_CLASSES}>
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          {t('nav.events')}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">{t('events.subtitle')}</p>
      </div>

      {state && <UptimeCalendar monitors={monitors} state={state} selectedMonth={resolvedMonth} />}

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ search: (prev) => ({ ...prev, month: prevMonth }) })}
          >
            <IconChevronLeft className="h-4 w-4" />
          </Button>

          <MonthPicker
            value={resolvedMonth}
            onChange={(value) => navigate({ search: (prev) => ({ ...prev, month: value }) })}
          />

          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ search: (prev) => ({ ...prev, month: nextMonth }) })}
          >
            <IconChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={eventType ?? 'all'}
            onValueChange={(value) =>
              navigate({
                search: (prev) => ({
                  ...prev,
                  type: value === 'all' ? undefined : (value as 'incident' | 'maintenance'),
                }),
              })
            }
          >
            <SelectTrigger className="w-44">
              <SelectValue>
                {typeOptions.find((o) => o.value === (eventType ?? 'all'))?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {typeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={selectedMonitor ?? ''}
            onValueChange={(value) =>
              navigate({
                search: (prev) => ({ ...prev, monitor: value || undefined }),
              })
            }
          >
            <SelectTrigger className="min-w-56">
              <SelectValue>
                {monitorOptions.find((o) => o.value === (selectedMonitor ?? ''))?.label ??
                  t('filter.all')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {monitorOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {pinned.length === 0 && timeline.length === 0 ? (
        <EmptyState
          icon={IconCalendar}
          iconClassName="text-emerald-600 dark:text-emerald-400"
          iconContainerClassName="bg-emerald-100 dark:bg-emerald-900/30"
          title={t('events.noEvents')}
          description={t('events.noIncidentsOrMaintenance')}
        />
      ) : (
        <div className="space-y-4">
          {pinned.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                {t('events.activeAndUpcoming')}
              </h3>
              {pinned.map((event) => (
                <MaintenanceEventCard
                  key={`maintenance-${event.maintenance.id}`}
                  event={event}
                  monitors={monitors}
                  nowMs={nowMs}
                />
              ))}
            </div>
          )}

          {timeline.length > 0 && (
            <div className="space-y-3">
              {pinned.length > 0 && <hr className="border-neutral-200 dark:border-neutral-800" />}
              {timeline.map((event) =>
                event.type === 'incident' ? (
                  <IncidentCard
                    key={`incident-${event.monitorId}-${event.start}-${event.end ?? 'open'}`}
                    event={event}
                  />
                ) : (
                  <MaintenanceEventCard
                    key={`maintenance-${event.maintenance.id}`}
                    event={event}
                    monitors={monitors}
                    nowMs={nowMs}
                  />
                ),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

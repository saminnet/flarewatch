import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
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
import { publicMonitorsQuery, monitorStateQuery } from '@/lib/query/monitors.queries';
import { useNow } from '@/lib/hooks/use-now';
import { shiftYearMonth, getUtcMonthBounds } from '@/lib/date';
import { projectTimeline } from '@/lib/status-projection';
import { PAGE_CONTAINER_CLASSES } from '@/lib/constants';

const eventsRoute = getRouteApi('/events');

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export function EventsPage() {
  const { t } = useTranslation();
  const { data: monitors } = useSuspenseQuery(publicMonitorsQuery());
  const { data: state } = useSuspenseQuery(monitorStateQuery());
  const { maintenances, loaderNowMs } = eventsRoute.useLoaderData();
  const nowMs = useNow({ serverTime: loaderNowMs });
  const {
    month: selectedMonth,
    monitor: selectedMonitor,
    type: eventType,
  } = eventsRoute.useSearch();
  const navigate = eventsRoute.useNavigate();
  const resolvedMonth = selectedMonth ?? getCurrentMonth();

  const { monthStart, monthEnd } = getUtcMonthBounds(resolvedMonth);

  const { pinned, timeline } = projectTimeline({
    state,
    monitors,
    maintenances,
    monthStart,
    monthEnd,
    nowMs,
    selectedMonitor,
    eventType: eventType ?? 'all',
  });

  const prevMonth = shiftYearMonth(resolvedMonth, -1);
  const nextMonth = shiftYearMonth(resolvedMonth, 1);

  const monitorOptions = [
    { value: '', label: t('filter.all') },
    ...monitors.map((m) => ({ value: m.id, label: m.name })),
  ];

  const typeOptions = [
    { value: 'all', label: t('filter.allEvents') },
    { value: 'incident', label: t('filter.incidents') },
    { value: 'maintenance', label: t('filter.maintenances') },
  ];

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

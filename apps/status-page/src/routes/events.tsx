import { useMemo } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { format, subMonths, addMonths, startOfMonth, endOfMonth } from 'date-fns';
import {
  IconChevronLeft,
  IconChevronRight,
  IconCalendar,
  IconAlertTriangle,
  IconTool,
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { MonthPicker } from '@/components/ui/month-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { PublicMonitor } from '@/lib/monitors';
import { publicMonitorsQuery, monitorStateQuery } from '@/lib/query/monitors.queries';
import { getMaintenances } from '@/lib/kv';
import { getMaintenanceStatus, getMaintenanceBorderClass } from '@/lib/maintenance';
import type { Maintenance, MonitorState } from '@flarewatch/shared';

interface EventsSearch {
  month?: string;
  monitor?: string;
  type?: 'all' | 'incident' | 'maintenance';
}

function getCurrentMonth(): string {
  // Use UTC to avoid server/client timezone hydration mismatches.
  return new Date().toISOString().slice(0, 7);
}

function isValidYearMonth(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

type IncidentEvent = {
  type: 'incident';
  monitorId: string;
  monitorName: string;
  start: number; // seconds
  end?: number; // seconds
  errors: string[];
};

type MaintenanceEvent = {
  type: 'maintenance';
  maintenance: Maintenance;
};

type TimelineEvent = IncidentEvent | MaintenanceEvent;

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
    return { maintenances };
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
  const { maintenances } = Route.useLoaderData();
  const { month: selectedMonth, monitor: selectedMonitor, type: eventType } = Route.useSearch();
  const navigate = Route.useNavigate();
  const resolvedMonth = selectedMonth ?? getCurrentMonth();

  const { monthDate, monthStart, monthEnd } = useMemo(() => {
    const monthDate = new Date(resolvedMonth + '-01');
    return {
      monthDate,
      monthStart: startOfMonth(monthDate),
      monthEnd: endOfMonth(monthDate),
    };
  }, [resolvedMonth]);

  const allEvents = useMemo(() => {
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
    events.sort((a, b) => {
      const aStart =
        a.type === 'incident' ? a.start * 1000 : new Date(a.maintenance.start).getTime();
      const bStart =
        b.type === 'incident' ? b.start * 1000 : new Date(b.maintenance.start).getTime();
      return bStart - aStart;
    });

    return events;
  }, [state, monitors, maintenances, monthStart, monthEnd, eventType, selectedMonitor]);

  const { prevMonth, nextMonth } = useMemo(
    () => ({
      prevMonth: format(subMonths(monthDate, 1), 'yyyy-MM'),
      nextMonth: format(addMonths(monthDate, 1), 'yyyy-MM'),
    }),
    [monthDate],
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
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          {t('nav.events')}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">{t('events.subtitle')}</p>
      </div>

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
            <SelectTrigger className="w-36">
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

      {allEvents.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
            <IconCalendar className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
            {t('events.noEvents')}
          </h3>
          <p className="mt-1 text-sm text-neutral-500">{t('events.noIncidentsOrMaintenance')}</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {allEvents.map((event) =>
            event.type === 'incident' ? (
              <IncidentCard
                key={`incident-${event.monitorId}-${event.start}-${event.end ?? 'open'}`}
                event={event}
              />
            ) : (
              <MaintenanceCard
                key={`maintenance-${event.maintenance.id}`}
                event={event}
                monitors={monitors}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

interface IncidentCardProps {
  event: IncidentEvent;
}

function IncidentCard({ event }: IncidentCardProps) {
  const { t } = useTranslation();
  const startDate = new Date(event.start * 1000);
  const endDate = event.end ? new Date(event.end * 1000) : null;
  const isOngoing = !event.end;
  const latestError = event.errors[event.errors.length - 1] ?? t('error.unknown');

  return (
    <Alert className="border-l-4 border-red-500 bg-red-50 dark:bg-red-950/30">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <AlertTitle className="flex items-center gap-2">
            <IconAlertTriangle className="h-4 w-4 text-red-500" />
            {event.monitorName}
            <Badge variant="outline" className="text-xs">
              {t('event.incident')}
            </Badge>
            {isOngoing && (
              <Badge variant="destructive" className="text-xs">
                {t('status.ongoing')}
              </Badge>
            )}
          </AlertTitle>

          <AlertDescription className="mt-2">
            <p className="text-neutral-700 dark:text-neutral-300">{latestError}</p>

            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-neutral-500">
              <span>
                <strong>{t('field.from')}</strong> {format(startDate, 'PPp')}
              </span>
              {endDate ? (
                <span>
                  <strong>{t('field.to')}</strong> {format(endDate, 'PPp')}
                </span>
              ) : (
                <span className="text-red-500">{t('status.ongoing')}</span>
              )}
            </div>
          </AlertDescription>
        </div>
      </div>
    </Alert>
  );
}

interface MaintenanceCardProps {
  event: MaintenanceEvent;
  monitors: PublicMonitor[];
}

function MaintenanceCard({ event, monitors }: MaintenanceCardProps) {
  const { t } = useTranslation();
  const { maintenance } = event;
  const startDate = new Date(maintenance.start);
  const endDate = maintenance.end ? new Date(maintenance.end) : null;
  const status = getMaintenanceStatus(maintenance);
  const isUpcoming = status === 'upcoming';
  const isOngoing = status === 'active';
  const isPast = status === 'past';

  // Get affected monitor names
  const affectedMonitors = maintenance.monitors
    ?.map((id) => monitors.find((m) => m.id === id))
    .filter((m): m is PublicMonitor => m !== undefined);

  const borderColor = getMaintenanceBorderClass(maintenance.color);

  return (
    <Alert className={`border-l-4 ${borderColor}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <AlertTitle className="flex items-center gap-2">
            <IconTool className="h-4 w-4 text-amber-500" />
            {maintenance.title ?? t('maintenance.scheduled')}
            <Badge variant="outline" className="text-xs">
              {t('event.maintenance')}
            </Badge>
            {isUpcoming && <Badge variant="secondary">{t('status.upcoming')}</Badge>}
            {isOngoing && <Badge variant="secondary">{t('status.ongoing')}</Badge>}
            {isPast && <Badge variant="outline">{t('status.completed')}</Badge>}
          </AlertTitle>

          <AlertDescription className="mt-2">
            <p className="text-neutral-700 dark:text-neutral-300">{maintenance.body}</p>

            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-neutral-500">
              <span>
                <strong>{t('field.from')}</strong> {format(startDate, 'PPp')}
              </span>
              {endDate ? (
                <span>
                  <strong>{t('field.to')}</strong> {format(endDate, 'PPp')}
                </span>
              ) : (
                <span>{t('maintenance.untilFurtherNotice')}</span>
              )}
            </div>

            {affectedMonitors && affectedMonitors.length > 0 && (
              <div className="mt-3">
                <span className="text-xs text-neutral-500">
                  {t('field.affectedMonitors')}
                  {': '}
                </span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {affectedMonitors.map((monitor) => (
                    <Badge key={monitor.id} variant="outline" className="text-xs">
                      {monitor.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </AlertDescription>
        </div>
      </div>
    </Alert>
  );
}

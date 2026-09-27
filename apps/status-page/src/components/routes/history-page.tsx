import { useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { IconChevronLeft, IconChevronRight, IconCalendar, IconPlus } from '@tabler/icons-react';
import type { Maintenance } from '@flarewatch/shared';
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
import { IncidentCard } from '@/components/history/incident-card';
import { MaintenanceEventCard } from '@/components/history/maintenance-event-card';
import { MaintenanceFormDialog } from '@/components/maintenance/maintenance-form-dialog';
import { DeleteMaintenanceDialog } from '@/components/maintenance/delete-maintenance-dialog';
import { snapshotQuery } from '@/lib/query/monitors.queries';
import { useAudience } from '@/lib/hooks/use-audience';
import { useNow } from '@/lib/hooks/use-now';
import { shiftYearMonth, getUtcMonthBounds } from '@/lib/date';
import { projectTimeline } from '@/lib/status-projection';
import { PAGE_CONTAINER_CLASSES } from '@/lib/constants';

const historyRoute = getRouteApi('/history');

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Dialogs stay mounted with their last target so they can animate out. */
type DialogTarget = { open: boolean; maintenance?: Maintenance; key: number };

const CLOSED: DialogTarget = { open: false, key: 0 };

export function HistoryPage() {
  const audience = useAudience();
  const operator = audience === 'operator';
  const {
    data: { monitors, state, maintenances },
  } = useSuspenseQuery(snapshotQuery(audience));
  const [editing, setEditing] = useState(CLOSED);
  const [deleting, setDeleting] = useState(CLOSED);
  const openFor = (maintenance?: Maintenance) => (prev: DialogTarget) => ({
    open: true,
    maintenance,
    key: prev.key + 1,
  });
  const closeDialog = (prev: DialogTarget) => ({ ...prev, open: false });
  const { loaderNowMs } = historyRoute.useLoaderData();
  const nowMs = useNow({ serverTime: loaderNowMs });
  const {
    month: selectedMonth,
    monitor: selectedMonitor,
    type: eventType,
  } = historyRoute.useSearch();
  const navigate = historyRoute.useNavigate();
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

  function maintenanceActions(maintenance: Maintenance) {
    if (!operator) return {};
    return {
      onEdit: () => setEditing(openFor(maintenance)),
      onDelete: () => setDeleting(openFor(maintenance)),
    };
  }

  const prevMonth = shiftYearMonth(resolvedMonth, -1);
  const nextMonth = shiftYearMonth(resolvedMonth, 1);

  const monitorOptions = [
    { value: '', label: 'All' },
    ...monitors.map((m) => ({ value: m.id, label: m.name })),
  ];

  const typeOptions = [
    { value: 'all', label: 'All types' },
    { value: 'incident', label: 'Incidents' },
    { value: 'maintenance', label: 'Maintenance windows' },
  ];

  return (
    <div className={PAGE_CONTAINER_CLASSES}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">History</h1>
          <p className="mt-1 text-sm text-muted-foreground">Incidents and scheduled maintenance</p>
        </div>
        {operator && (
          <Button onClick={() => setEditing(openFor())}>
            <IconPlus className="size-4" />
            Add maintenance window
          </Button>
        )}
      </div>

      {state && <UptimeCalendar monitors={monitors} state={state} selectedMonth={resolvedMonth} />}

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigate({ search: (prev) => ({ ...prev, month: prevMonth }) })}
          >
            <IconChevronLeft className="h-4 w-4" />
          </Button>

          <MonthPicker
            value={resolvedMonth}
            onChange={(value) => void navigate({ search: (prev) => ({ ...prev, month: value }) })}
          />

          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigate({ search: (prev) => ({ ...prev, month: nextMonth }) })}
          >
            <IconChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={eventType ?? 'all'}
            onValueChange={(value) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  type: value === 'incident' || value === 'maintenance' ? value : undefined,
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
              void navigate({
                search: (prev) => ({ ...prev, monitor: value || undefined }),
              })
            }
          >
            <SelectTrigger className="min-w-56">
              <SelectValue>
                {monitorOptions.find((o) => o.value === (selectedMonitor ?? ''))?.label ?? 'All'}
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
          iconClassName="text-status-operational"
          iconContainerClassName="bg-status-operational-bg"
          title="Nothing this month"
          description="No incidents or maintenance scheduled for this period."
        />
      ) : (
        <div className="space-y-4">
          {pinned.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Active & Upcoming Maintenance
              </h3>
              {pinned.map((event) => (
                <MaintenanceEventCard
                  key={`maintenance-${event.maintenance.id}`}
                  event={event}
                  monitors={monitors}
                  nowMs={nowMs}
                  {...maintenanceActions(event.maintenance)}
                />
              ))}
            </div>
          )}

          {timeline.length > 0 && (
            <div className="space-y-3">
              {pinned.length > 0 && <hr className="border-border" />}
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
                    {...maintenanceActions(event.maintenance)}
                  />
                ),
              )}
            </div>
          )}
        </div>
      )}

      {operator && (
        <>
          <MaintenanceFormDialog
            key={editing.key}
            open={editing.open}
            maintenance={editing.maintenance}
            monitors={monitors}
            onClose={() => setEditing(closeDialog)}
          />
          <DeleteMaintenanceDialog
            key={deleting.key}
            open={deleting.open}
            maintenance={deleting.maintenance}
            onClose={() => setDeleting(closeDialog)}
          />
        </>
      )}
    </div>
  );
}

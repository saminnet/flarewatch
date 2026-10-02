import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { IconArrowLeft } from '@tabler/icons-react';
import type { StatusView } from '@flarewatch/shared';
import { MonitorDetail } from '@/components/monitor-card';
import { IncidentCard } from '@/components/history/incident-card';
import { MaintenanceEventCard } from '@/components/history/maintenance-event-card';
import { PAGE_CONTAINER_CLASSES, TIME_MS, UPTIME_DAYS } from '@/lib/constants';
import { useAudience } from '@/lib/hooks/use-audience';
import { useNow } from '@/lib/hooks/use-now';
import type { AdminMonitor, Snapshot } from '@/lib/public-view';
import { projectTimeline } from '@/lib/status-projection';
import { latencyQuery, snapshotQuery } from '@/lib/query/monitors.queries';
import { audienceOf } from '@/lib/session';

function drawsLatency(monitor: AdminMonitor): boolean {
  return monitor.method !== 'HEARTBEAT' && !monitor.hideLatencyChart;
}

export const Route = createFileRoute('/monitors/$monitorId')({
  loaderDeps: ({ search }) => ({ view: search.view }),
  loader: async ({ context, deps, params }) => {
    const snapshot = await context.queryClient.ensureQueryData(
      snapshotQuery(audienceOf(context.session, deps.view)),
    );
    // A visitor asking for a private monitor gets the same answer as for a missing one.
    const monitor = snapshot.monitors.find((candidate) => candidate.id === params.monitorId);
    if (!monitor) throw notFound();
    if (drawsLatency(monitor)) {
      await context.queryClient.ensureQueryData(latencyQuery(monitor.id));
    }
    return { loaderNowMs: Date.now() };
  },
  component: MonitorPage,
});

function MonitorPage() {
  const { monitorId } = Route.useParams();
  const audience = useAudience();
  const { data: snapshot } = useSuspenseQuery(snapshotQuery(audience));
  const { monitors, state, maintenances } = snapshot;
  const nowMs = useNow({ serverTime: Route.useLoaderData().loaderNowMs });
  const monitor = monitors.find((candidate) => candidate.id === monitorId);
  const { data: latency } = useQuery({
    ...latencyQuery(monitorId),
    enabled: monitor !== undefined && drawsLatency(monitor),
  });
  if (!monitor) throw notFound();

  return (
    <div className={PAGE_CONTAINER_CLASSES}>
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <IconArrowLeft className="size-4" aria-hidden="true" />
        All monitors
      </Link>

      {state ? (
        <MonitorDetail
          monitor={monitor}
          state={state}
          maintenances={maintenances}
          latency={latency}
          operator={audience === 'operator'}
        />
      ) : (
        <p className="text-sm text-muted-foreground">No monitoring data available yet.</p>
      )}

      <MonitorHistory monitorId={monitor.id} snapshot={snapshot} state={state} nowMs={nowMs} />
    </div>
  );
}

const RECENT_EVENTS_LIMIT = 5;

/** This monitor's maintenance windows and incidents, newest first after anything ongoing. */
function MonitorHistory({
  monitorId,
  snapshot,
  state,
  nowMs,
}: {
  monitorId: string;
  snapshot: Snapshot;
  state: StatusView | null;
  nowMs: number;
}) {
  const { pinned, timeline } = projectTimeline({
    state,
    monitors: snapshot.monitors,
    maintenances: snapshot.maintenances,
    // Incidents are kept for the same 90 days.
    monthStart: new Date(nowMs - UPTIME_DAYS * TIME_MS.DAY),
    monthEnd: new Date(nowMs + 366 * TIME_MS.DAY),
    nowMs,
    selectedMonitor: monitorId,
    eventType: 'all',
    nextRunOnly: true,
  });
  const events = [...pinned, ...timeline];

  return (
    <section className="mt-6" aria-labelledby="monitor-history">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="monitor-history" className="text-base font-semibold text-foreground">
          History
        </h2>
        <Link
          to="/history"
          search={(prev) => ({ ...prev, monitor: monitorId })}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Full history
        </Link>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {`No incidents or maintenance in the last ${UPTIME_DAYS} days.`}
        </p>
      ) : (
        <div className="space-y-3">
          {events
            .slice(0, RECENT_EVENTS_LIMIT)
            .map((event) =>
              event.type === 'incident' ? (
                <IncidentCard key={`incident-${event.start}`} event={event} />
              ) : (
                <MaintenanceEventCard
                  key={`maintenance-${event.maintenance.id}-${event.occurrence.start}`}
                  event={event}
                  monitors={snapshot.monitors}
                  nowMs={nowMs}
                />
              ),
            )}
        </div>
      )}
    </section>
  );
}

import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { IconArrowLeft } from '@tabler/icons-react';
import type { MonitorState } from '@flarewatch/shared';
import { MonitorDetail } from '@/components/monitor-card';
import { IncidentCard } from '@/components/events/incident-card';
import { MaintenanceEventCard } from '@/components/events/maintenance-event-card';
import { PAGE_CONTAINER_CLASSES, TIME_MS, UPTIME_DAYS } from '@/lib/constants';
import { useAudience } from '@/lib/hooks/use-audience';
import { useNow } from '@/lib/hooks/use-now';
import type { Snapshot } from '@/lib/public-view';
import { projectTimeline } from '@/lib/status-projection';
import { snapshotQuery } from '@/lib/query/monitors.queries';
import { audienceOf } from '@/lib/session';

export const Route = createFileRoute('/monitors/$monitorId')({
  loaderDeps: ({ search }) => ({ view: search.view }),
  loader: async ({ context, deps, params }) => {
    const snapshot = await context.queryClient.ensureQueryData(
      snapshotQuery(audienceOf(context.session, deps.view)),
    );
    // A visitor asking for a private monitor gets the same answer as for a missing one.
    if (!snapshot.monitors.some((monitor) => monitor.id === params.monitorId)) throw notFound();
    return { loaderNowMs: Date.now() };
  },
  component: MonitorPage,
});

function MonitorPage() {
  const { monitorId } = Route.useParams();
  const audience = useAudience();
  const { data: snapshot } = useSuspenseQuery(snapshotQuery(audience));
  const { monitors, state } = snapshot;
  const nowMs = useNow({ serverTime: Route.useLoaderData().loaderNowMs });
  const monitor = monitors.find((candidate) => candidate.id === monitorId);
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
        <MonitorDetail monitor={monitor} state={state} operator={audience === 'operator'} />
      ) : (
        <p className="text-sm text-muted-foreground">No monitoring data available yet.</p>
      )}

      <MonitorEvents monitorId={monitor.id} snapshot={snapshot} state={state} nowMs={nowMs} />
    </div>
  );
}

const RECENT_EVENTS_LIMIT = 5;

/** This monitor's maintenance windows and incidents, newest first after anything ongoing. */
function MonitorEvents({
  monitorId,
  snapshot,
  state,
  nowMs,
}: {
  monitorId: string;
  snapshot: Snapshot;
  state: MonitorState | null;
  nowMs: number;
}) {
  const { pinned, timeline } = projectTimeline({
    state,
    monitors: snapshot.monitors,
    maintenances: snapshot.maintenances,
    // Incidents are kept for the same 90 days; the far end keeps every upcoming window.
    monthStart: new Date(nowMs - UPTIME_DAYS * TIME_MS.DAY),
    monthEnd: new Date(8.64e15),
    nowMs,
    selectedMonitor: monitorId,
    eventType: 'all',
  });
  const events = [...pinned, ...timeline];

  return (
    <section className="mt-6" aria-labelledby="monitor-events">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="monitor-events" className="text-base font-semibold text-foreground">
          Events
        </h2>
        <Link
          to="/events"
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
                  key={`maintenance-${event.maintenance.id}`}
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

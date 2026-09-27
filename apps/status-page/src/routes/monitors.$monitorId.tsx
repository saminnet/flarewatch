import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { IconArrowLeft, IconHistory } from '@tabler/icons-react';
import { MonitorDetail } from '@/components/monitor-card';
import { PAGE_CONTAINER_CLASSES } from '@/lib/constants';
import { useAudience } from '@/lib/hooks/use-audience';
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
  },
  component: MonitorPage,
});

function MonitorPage() {
  const { monitorId } = Route.useParams();
  const audience = useAudience();
  const {
    data: { monitors, state },
  } = useSuspenseQuery(snapshotQuery(audience));
  const monitor = monitors.find((candidate) => candidate.id === monitorId);
  if (!monitor) throw notFound();

  return (
    <div className={PAGE_CONTAINER_CLASSES}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <IconArrowLeft className="size-4" aria-hidden="true" />
          All monitors
        </Link>
        <Link
          to="/events"
          search={(prev) => ({ ...prev, monitor: monitor.id })}
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <IconHistory className="size-4" aria-hidden="true" />
          Incidents and maintenance
        </Link>
      </div>

      {state ? (
        <MonitorDetail monitor={monitor} state={state} operator={audience === 'operator'} />
      ) : (
        <p className="text-sm text-muted-foreground">No monitoring data available yet.</p>
      )}
    </div>
  );
}

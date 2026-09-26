import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { OverallStatus } from '@/components/overall-status';
import { MonitorList, type MonitorKindFilter } from '@/components/monitor-list';
import { MaintenanceAlerts } from '@/components/maintenance/alerts';
import { PAGE_CONTAINER_CLASSES } from '@/lib/constants';
import { snapshotQuery, uiPrefsQuery } from '@/lib/query/monitors.queries';
import { useAudience } from '@/lib/hooks/use-audience';
import { audienceOf } from '@/lib/session';

interface IndexSearch {
  kind?: MonitorKindFilter;
}

export const Route = createFileRoute('/')({
  validateSearch: (search): IndexSearch => ({
    kind: search.kind === 'web' || search.kind === 'jobs' ? search.kind : undefined,
  }),
  loaderDeps: ({ search }) => ({ view: search.view }),
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(snapshotQuery(audienceOf(context.session, deps.view))),
      context.queryClient.ensureQueryData(uiPrefsQuery()),
    ]);
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { kind } = Route.useSearch();
  const navigate = Route.useNavigate();
  const audience = useAudience();
  const {
    data: { monitors, groups, state, maintenances },
  } = useSuspenseQuery(snapshotQuery(audience));
  const { data: uiPrefs } = useSuspenseQuery(uiPrefsQuery());

  // State can be null if KV has no data yet (worker hasn't run)
  if (!state) {
    return (
      <div className={PAGE_CONTAINER_CLASSES}>
        <div className="rounded-lg border border-border bg-muted p-8 text-center">
          <h2 className="text-lg font-medium text-foreground">No monitoring data available yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The monitoring worker hasn't run yet, or the KV store is not configured.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={PAGE_CONTAINER_CLASSES}>
      <div className="space-y-3">
        <OverallStatus
          state={state}
          monitorCount={monitors.length}
          jobCount={monitors.filter((monitor) => monitor.method === 'HEARTBEAT').length}
        />

        <MaintenanceAlerts
          maintenances={maintenances}
          monitors={monitors}
          nowMs={state.lastUpdate * 1000}
        />

        <section>
          <h2 className="mb-3 text-base font-semibold text-foreground">Monitors</h2>
          <MonitorList
            monitors={monitors}
            state={state}
            groups={groups}
            uiPrefs={uiPrefs}
            operator={audience === 'operator'}
            kind={kind}
            onKindChange={(value) =>
              void navigate({ search: (prev) => ({ ...prev, kind: value }) })
            }
          />
        </section>
      </div>
    </div>
  );
}

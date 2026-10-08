import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { OverallStatus } from '@/components/overall-status';
import { MonitorList, type MonitorKindFilter } from '@/components/monitor-list';
import { MaintenanceAlerts } from '@/components/maintenance/alerts';
import { AnnouncementBanner } from '@/components/announcements/announcement-banner';
import { PAGE_CONTAINER_CLASSES } from '@/lib/constants';
import { snapshotQuery, uiPrefsQuery } from '@/lib/query/monitors.queries';
import { useAudience } from '@/lib/hooks/use-audience';
import { useNow } from '@/lib/hooks/use-now';
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
    await context.queryClient.ensureQueryData(
      snapshotQuery(audienceOf(context.session, deps.view)),
    );
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { kind } = Route.useSearch();
  const navigate = Route.useNavigate();
  const audience = useAudience();
  const {
    data: { monitors, groups, state, maintenances, announcements },
  } = useSuspenseQuery(snapshotQuery(audience));
  const { data: uiPrefs } = useSuspenseQuery(uiPrefsQuery());
  const nowMs = useNow({ serverTime: (state?.lastUpdate ?? 0) * 1000 });

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
        <OverallStatus monitors={monitors} state={state} maintenances={maintenances} />

        <AnnouncementBanner announcements={announcements} nowMs={nowMs} />

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
            maintenances={maintenances}
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

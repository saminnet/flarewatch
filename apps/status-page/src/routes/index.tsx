import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { OverallStatus } from '@/components/overall-status';
import { MonitorList, type MonitorKindFilter } from '@/components/monitor-list';
import { MaintenanceAlerts } from '@/components/maintenance/alerts';
import { PAGE_CONTAINER_CLASSES } from '@/lib/constants';
import {
  configQuery,
  maintenancesQuery,
  monitorStateQuery,
  publicMonitorsQuery,
  uiPrefsQuery,
} from '@/lib/query/monitors.queries';

interface IndexSearch {
  kind?: MonitorKindFilter;
}

export const Route = createFileRoute('/')({
  validateSearch: (search): IndexSearch => ({
    kind: search.kind === 'web' || search.kind === 'jobs' ? search.kind : undefined,
  }),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(configQuery()),
      context.queryClient.ensureQueryData(monitorStateQuery()),
      context.queryClient.ensureQueryData(publicMonitorsQuery()),
      context.queryClient.ensureQueryData(uiPrefsQuery()),
      context.queryClient.ensureQueryData(maintenancesQuery()),
    ]);
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { t } = useTranslation();
  const { kind } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: config } = useSuspenseQuery(configQuery());
  const { data: state } = useSuspenseQuery(monitorStateQuery());
  const { data: monitors } = useSuspenseQuery(publicMonitorsQuery());
  const { data: uiPrefs } = useSuspenseQuery(uiPrefsQuery());
  const { data: maintenances } = useSuspenseQuery(maintenancesQuery());
  const groups = config.statusPage?.group ?? {};

  // State can be null if KV has no data yet (worker hasn't run)
  if (!state) {
    return (
      <div className={PAGE_CONTAINER_CLASSES}>
        <div className="rounded-lg border border-border bg-muted p-8 text-center">
          <h2 className="text-lg font-medium text-foreground">{t('error.noMonitoringData')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('error.workerNotConfigured')}</p>
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
          <h2 className="mb-3 text-base font-semibold text-neutral-900 dark:text-neutral-100">
            {t('monitor.title')}
          </h2>
          <MonitorList
            monitors={monitors}
            state={state}
            groups={groups}
            uiPrefs={uiPrefs}
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

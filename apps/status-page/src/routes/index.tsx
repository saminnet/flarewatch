import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { OverallStatus } from '@/components/overall-status';
import { MonitorList } from '@/components/monitor-list';
import { MaintenanceAlerts } from '@/components/maintenance/alerts';
import { pageConfig } from '@flarewatch/config';
import { PAGE_CONTAINER_CLASSES } from '@/lib/constants';
import {
  maintenancesQuery,
  monitorStateQuery,
  publicMonitorsQuery,
  uiPrefsQuery,
} from '@/lib/query/monitors.queries';

export const Route = createFileRoute('/')({
  loader: async ({ context }) => {
    await Promise.all([
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
  const { data: state } = useSuspenseQuery(monitorStateQuery());
  const { data: monitors } = useSuspenseQuery(publicMonitorsQuery());
  const { data: uiPrefs } = useSuspenseQuery(uiPrefsQuery());
  const { data: maintenances } = useSuspenseQuery(maintenancesQuery());

  if (!state) {
    return (
      <div className={PAGE_CONTAINER_CLASSES}>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
            {t('error.noMonitoringData')}
          </h2>
          <p className="mt-2 text-sm text-neutral-500">{t('error.workerNotConfigured')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={PAGE_CONTAINER_CLASSES}>
      <div className="space-y-4">
        <OverallStatus state={state} />

        <MaintenanceAlerts
          maintenances={maintenances}
          monitors={monitors}
          nowMs={state.lastUpdate * 1000}
        />

        <section>
          <h2 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {t('monitor.title')}
          </h2>
          <MonitorList
            monitors={monitors}
            state={state}
            groups={pageConfig.group}
            uiPrefs={uiPrefs}
          />
        </section>
      </div>
    </div>
  );
}

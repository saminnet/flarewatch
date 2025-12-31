import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCalendar } from '@tabler/icons-react';
import type { Maintenance } from '@flarewatch/shared';
import type { PublicMonitor } from '@/lib/monitors';
import { filterMaintenances } from '@/lib/maintenance';
import { useMonitorNameMap } from '@/lib/hooks/use-monitor-name-map';
import { MaintenanceCard } from './maintenance-card';

interface MaintenanceAlertsProps {
  maintenances: Maintenance[];
  monitors: PublicMonitor[];
  nowMs?: number;
}

export function MaintenanceAlerts({ maintenances, monitors, nowMs }: MaintenanceAlertsProps) {
  const { t } = useTranslation();
  const monitorNamesById = useMonitorNameMap(monitors);
  const stableNowMs = nowMs ?? Date.now();

  const { active: activeMaintenances, upcoming: upcomingMaintenances } = useMemo(
    () => filterMaintenances(maintenances, { nowMs: stableNowMs }),
    [maintenances, stableNowMs],
  );

  if (activeMaintenances.length === 0 && upcomingMaintenances.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Active Maintenances */}
      {activeMaintenances.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 flex items-center gap-2">
            {t('maintenance.active')}
          </h3>
          {activeMaintenances.map((m) => (
            <MaintenanceCard
              key={`active-${m.id}`}
              maintenance={m}
              monitorNames={monitorNamesById}
              nowMs={stableNowMs}
              variant="active"
            />
          ))}
        </div>
      )}

      {/* Upcoming Maintenances */}
      {upcomingMaintenances.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 flex items-center gap-2">
            <IconCalendar className="h-5 w-5 text-blue-500" />
            {t('maintenance.upcoming')}
          </h3>
          {upcomingMaintenances.map((m) => (
            <MaintenanceCard
              key={`upcoming-${m.id}`}
              maintenance={m}
              monitorNames={monitorNamesById}
              nowMs={stableNowMs}
              variant="upcoming"
            />
          ))}
        </div>
      )}
    </div>
  );
}

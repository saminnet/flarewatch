import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { IconTool } from '@tabler/icons-react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { MaintenanceStatusBadge } from '@/components/maintenance/status-badge';
import type { PublicMonitor } from '@/lib/monitors';
import {
  getMaintenanceStatus,
  getMaintenanceBorderClass,
  resolveAffectedMonitors,
} from '@/lib/maintenance';
import type { MaintenanceEvent } from './types';

interface MaintenanceEventCardProps {
  event: MaintenanceEvent;
  monitors: PublicMonitor[];
  nowMs: number;
}

export function MaintenanceEventCard({ event, monitors, nowMs }: MaintenanceEventCardProps) {
  const { t } = useTranslation();
  const { maintenance } = event;
  const startDate = new Date(maintenance.start);
  const endDate = maintenance.end ? new Date(maintenance.end) : null;
  const status = getMaintenanceStatus(maintenance, nowMs);

  const affectedMonitors = resolveAffectedMonitors(maintenance.monitors, monitors);
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
            <MaintenanceStatusBadge status={status} />
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

            {affectedMonitors.length > 0 && (
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

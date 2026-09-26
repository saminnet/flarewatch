import { IconTool } from '@tabler/icons-react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { MaintenanceStatusBadge } from '@/components/maintenance/status-badge';
import type { PublicMonitor } from '@/lib/public-view';
import { cn } from '@/lib/utils';
import {
  getMaintenanceStatus,
  getMaintenanceColors,
  resolveAffectedMonitors,
} from '@/lib/maintenance';
import { DateRange } from './date-range';
import type { MaintenanceEvent } from './types';

interface MaintenanceEventCardProps {
  event: MaintenanceEvent;
  monitors: PublicMonitor[];
  nowMs: number;
}

export function MaintenanceEventCard({ event, monitors, nowMs }: MaintenanceEventCardProps) {
  const { maintenance } = event;
  const startDate = new Date(maintenance.start);
  const endDate = maintenance.end ? new Date(maintenance.end) : null;
  const status = getMaintenanceStatus(maintenance, nowMs);

  const affectedMonitors = resolveAffectedMonitors(maintenance.monitors, monitors);
  const colors = getMaintenanceColors(maintenance.color);

  return (
    <Alert className={colors.bg}>
      <AlertTitle className="flex items-center gap-2">
        <IconTool className={cn('h-4 w-4', colors.icon)} />
        {maintenance.title ?? 'Scheduled Maintenance'}
        <Badge variant="outline" className="text-xs">
          Maintenance
        </Badge>
        <MaintenanceStatusBadge status={status} />
      </AlertTitle>

      <AlertDescription className="mt-1.5">
        <p className="text-foreground">{maintenance.body}</p>
        <DateRange start={startDate} end={endDate} noEndLabel="Until further notice" />

        {affectedMonitors.length > 0 && (
          <div className="mt-2">
            <span className="text-xs text-muted-foreground">
              Affected Monitors
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
    </Alert>
  );
}

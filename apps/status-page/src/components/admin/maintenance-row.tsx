import { formatUtc } from '@/lib/date';
import {
  IconPencil,
  IconTrash,
  IconAlertTriangle,
  IconCircleCheck,
  IconClock,
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MaintenanceStatusBadge } from '@/components/maintenance/status-badge';
import type { Maintenance } from '@flarewatch/shared';
import {
  getMaintenanceStatus,
  getMaintenanceColors,
  getSeverityOption,
  resolveAffectedMonitors,
} from '@/lib/maintenance';
import { cn } from '@/lib/utils';

interface MaintenanceRowProps {
  maintenance: Maintenance;
  monitors: { id: string; name: string }[];
  nowMs: number;
  onEdit: () => void;
  onDelete: () => void;
}

const STATUS_ICONS = {
  active: IconAlertTriangle,
  upcoming: IconClock,
  scheduled: IconClock,
  past: IconCircleCheck,
} as const;

export function MaintenanceRow({
  maintenance,
  monitors,
  nowMs,
  onEdit,
  onDelete,
}: MaintenanceRowProps) {
  const startDate = new Date(maintenance.start);
  const endDate = maintenance.end ? new Date(maintenance.end) : null;
  const status = getMaintenanceStatus(maintenance, nowMs);
  const affectedMonitors = resolveAffectedMonitors(maintenance.monitors, monitors);
  const severity = getSeverityOption(maintenance.color);
  const colors = getMaintenanceColors(maintenance.color);
  const StatusIcon = STATUS_ICONS[status];

  return (
    <div className="flex items-stretch rounded-lg border border-border bg-card overflow-hidden">
      <div className={cn('w-1.5 shrink-0', colors.dot)} />

      <div className="flex-1 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusIcon
                className={cn(
                  'size-4 shrink-0',
                  status === 'active' && 'text-status-degraded-text',
                  (status === 'upcoming' || status === 'scheduled') && 'text-status-maintenance',
                  status === 'past' && 'text-status-operational',
                )}
              />
              <h3 className="font-medium text-foreground truncate">
                {maintenance.title ?? 'Scheduled Maintenance'}
              </h3>
              <Badge className={severity.badge}>{severity.label}</Badge>
              <MaintenanceStatusBadge status={status} />
            </div>

            <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{maintenance.body}</p>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="font-medium">From:</span>
                {formatUtc(startDate, "MMM d, yyyy h:mm a 'UTC'")}
              </span>
              {endDate && (
                <span className="flex items-center gap-1">
                  <span className="font-medium">To:</span>
                  {formatUtc(endDate, "MMM d, yyyy h:mm a 'UTC'")}
                </span>
              )}
            </div>

            {affectedMonitors.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {affectedMonitors.map((monitor) => (
                  <Badge key={monitor.id} variant="outline" className="text-xs">
                    {monitor.name}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onEdit}
              aria-label={'Edit ' + (maintenance.title ?? 'maintenance')}
              className="text-muted-foreground hover:text-foreground"
            >
              <IconPencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDelete}
              aria-label={'Delete ' + (maintenance.title ?? 'maintenance')}
              className="text-muted-foreground hover:text-destructive"
            >
              <IconTrash className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

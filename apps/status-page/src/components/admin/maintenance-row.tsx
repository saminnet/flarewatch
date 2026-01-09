import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/lib/date';
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
  past: IconCircleCheck,
} as const;

export function MaintenanceRow({
  maintenance,
  monitors,
  nowMs,
  onEdit,
  onDelete,
}: MaintenanceRowProps) {
  const { t } = useTranslation();
  const startDate = new Date(maintenance.start);
  const endDate = maintenance.end ? new Date(maintenance.end) : null;
  const status = getMaintenanceStatus(maintenance, nowMs);
  const affectedMonitors = resolveAffectedMonitors(maintenance.monitors, monitors);
  const severity = getSeverityOption(maintenance.color);
  const StatusIcon = STATUS_ICONS[status];

  return (
    <div className="flex items-stretch rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
      <div className={cn('w-1.5 shrink-0', severity.dot)} />

      <div className="flex-1 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Header row */}
            <div className="flex items-center gap-2 flex-wrap">
              <StatusIcon
                className={cn(
                  'size-4 shrink-0',
                  status === 'active' && 'text-amber-500',
                  status === 'upcoming' && 'text-blue-500',
                  status === 'past' && 'text-emerald-500',
                )}
              />
              <h3 className="font-medium text-neutral-900 dark:text-neutral-100 truncate">
                {maintenance.title ?? t('maintenance.scheduled')}
              </h3>
              <Badge className={severity.badge}>{t(severity.labelKey)}</Badge>
              <MaintenanceStatusBadge status={status} />
            </div>

            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400 line-clamp-2">
              {maintenance.body}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
              <span className="flex items-center gap-1">
                <span className="font-medium">{t('field.from')}:</span>
                {formatDateTime(startDate)}
              </span>
              {endDate && (
                <span className="flex items-center gap-1">
                  <span className="font-medium">{t('field.to')}:</span>
                  {formatDateTime(endDate)}
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

          <div className="flex items-center gap-1 shrink-0" role="group" aria-label="Actions">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onEdit}
              aria-label={'Edit ' + (maintenance.title ?? 'maintenance')}
              className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            >
              <IconPencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDelete}
              aria-label={'Delete ' + (maintenance.title ?? 'maintenance')}
              className="text-neutral-500 hover:text-red-500"
            >
              <IconTrash className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

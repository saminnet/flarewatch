import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { IconPencil, IconTrash } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Maintenance } from '@flarewatch/shared';
import { getMaintenanceStatus } from '@/lib/maintenance';

interface MaintenanceRowProps {
  maintenance: Maintenance;
  monitors: { id: string; name: string }[];
  onEdit: () => void;
  onDelete: () => void;
}

export function MaintenanceRow({ maintenance, monitors, onEdit, onDelete }: MaintenanceRowProps) {
  const { t } = useTranslation();
  const startDate = new Date(maintenance.start);
  const endDate = maintenance.end ? new Date(maintenance.end) : null;
  const status = getMaintenanceStatus(maintenance);
  const isUpcoming = status === 'upcoming';
  const isOngoing = status === 'active';
  const isPast = status === 'past';

  const affectedMonitors = maintenance.monitors
    ?.map((id) => monitors.find((m) => m.id === id))
    .filter((m): m is { id: string; name: string } => m !== undefined);

  const severity = useMemo(() => {
    const defaultSeverity = {
      label: t('event.maintenance'),
      className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    };

    const severityConfig: Record<string, { label: string; className: string }> = {
      green: {
        label: t('severity.minor'),
        className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
      },
      yellow: defaultSeverity,
      blue: {
        label: t('severity.info'),
        className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
      },
      red: {
        label: t('severity.critical'),
        className: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
      },
    };

    return severityConfig[maintenance.color ?? 'yellow'] ?? defaultSeverity;
  }, [t, maintenance.color]);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
              {maintenance.title ?? t('maintenance.scheduled')}
            </h3>
            <Badge className={severity.className}>{severity.label}</Badge>
            {isUpcoming && <Badge variant="secondary">{t('status.upcoming')}</Badge>}
            {isOngoing && <Badge variant="secondary">{t('status.ongoing')}</Badge>}
            {isPast && <Badge variant="outline">{t('status.completed')}</Badge>}
          </div>

          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{maintenance.body}</p>

          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-neutral-500">
            <span>
              {t('field.from')}: {format(startDate, 'PPp')}
            </span>
            {endDate && (
              <span>
                {t('field.to')}: {format(endDate, 'PPp')}
              </span>
            )}
          </div>

          {affectedMonitors && affectedMonitors.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {affectedMonitors.map((monitor) => (
                <Badge key={monitor.id} variant="outline" className="text-xs">
                  {monitor.name}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="Actions">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onEdit}
            aria-label={'Edit ' + (maintenance.title ?? 'maintenance')}
          >
            <IconPencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            aria-label={'Delete ' + (maintenance.title ?? 'maintenance')}
          >
            <IconTrash className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

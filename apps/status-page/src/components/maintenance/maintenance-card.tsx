import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconCalendar, IconClock } from '@tabler/icons-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Maintenance } from '@flarewatch/shared';
import {
  formatTimeUntil,
  formatDateRange,
  getMaintenanceColors,
  getSeverityOption,
} from '@/lib/maintenance';

interface MaintenanceCardProps {
  maintenance: Maintenance;
  monitorNames: Map<string, string>;
  nowMs: number;
  variant: 'active' | 'upcoming';
}

export function MaintenanceCard({
  maintenance,
  monitorNames,
  nowMs,
  variant,
}: MaintenanceCardProps) {
  const { t } = useTranslation();
  const color = maintenance.color ?? 'yellow';
  const colors = getMaintenanceColors(color);
  const severity = getSeverityOption(color);
  const start = new Date(maintenance.start);
  const end = maintenance.end ? new Date(maintenance.end) : null;
  const now = new Date(nowMs);
  const isActive = variant === 'active';
  const Icon = isActive ? IconAlertTriangle : IconCalendar;

  return (
    <div
      className={cn(
        'flex items-stretch rounded-lg border overflow-hidden',
        isActive ? colors.bg : 'bg-white dark:bg-neutral-900',
        colors.border,
      )}
    >
      <div className={cn('w-1.5 shrink-0', severity.dot)} />

      <div className={cn('flex-1', isActive ? 'p-3' : 'p-4')}>
        <div className="flex items-start gap-3">
          <Icon className={cn('size-5 mt-0.5 shrink-0', colors.icon)} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-medium text-neutral-900 dark:text-neutral-100">
                {maintenance.title ?? t('maintenance.scheduled')}
              </h4>
              {isActive ? (
                <Badge variant="secondary" className="text-xs">
                  {t('status.ongoing')}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">
                  {t('maintenance.startsIn', { time: formatTimeUntil(start, now) })}
                </Badge>
              )}
            </div>
            {maintenance.body && (
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                {maintenance.body}
              </p>
            )}
            <div
              className={cn(
                'mt-3 flex items-center text-xs text-neutral-500',
                isActive ? 'gap-2 flex-wrap' : 'gap-4',
              )}
            >
              <span className="flex items-center gap-1">
                <IconClock className="size-3.5" />
                {formatDateRange(start, end)}
              </span>
              {isActive && end && (
                <span className="text-amber-600 dark:text-amber-400 font-medium">
                  {t('maintenance.endsIn', { time: formatTimeUntil(end, now) })}
                </span>
              )}
            </div>
            {maintenance.monitors && maintenance.monitors.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {maintenance.monitors.map((id) => (
                  <Badge key={id} variant="outline" className="text-xs">
                    {monitorNames.get(id) ?? id}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

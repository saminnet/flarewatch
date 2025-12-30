import { useTranslation } from 'react-i18next';
import { IconCalendar, IconClock } from '@tabler/icons-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Maintenance } from '@flarewatch/shared';
import { formatTimeUntil, formatDateRange, getMaintenanceColors } from '@/lib/maintenance';

interface UpcomingMaintenanceCardProps {
  maintenance: Maintenance;
  monitorNames: Map<string, string>;
  nowMs?: number;
}

export function UpcomingMaintenanceCard({
  maintenance,
  monitorNames,
  nowMs,
}: UpcomingMaintenanceCardProps) {
  const { t } = useTranslation();
  const colors = getMaintenanceColors(maintenance.color);
  const start = new Date(maintenance.start);
  const end = maintenance.end ? new Date(maintenance.end) : null;
  const now = nowMs ? new Date(nowMs) : new Date();

  return (
    <Card className={cn('p-4 border', colors.border, 'bg-white dark:bg-neutral-950')}>
      <div className="flex items-start gap-3">
        <IconCalendar className={cn('h-5 w-5 mt-0.5 shrink-0', colors.icon)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="font-medium text-neutral-900 dark:text-neutral-100">
              {maintenance.title ?? t('maintenance.scheduled')}
            </h4>
            <Badge variant="outline" className="text-xs">
              {t('maintenance.startsIn', { time: formatTimeUntil(start, now) })}
            </Badge>
          </div>
          {maintenance.body && (
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              {maintenance.body}
            </p>
          )}
          <div className="mt-2 flex items-center gap-4 text-xs text-neutral-500">
            <span className="flex items-center gap-1">
              <IconClock className="h-4 w-4" />
              {formatDateRange(start, end)}
            </span>
          </div>
          {maintenance.monitors && maintenance.monitors.length > 0 && (
            <div className="mt-2 text-xs text-neutral-500">
              {t('field.affectedMonitors')}
              {': '}
              {maintenance.monitors.map((id) => monitorNames.get(id) ?? id).join(', ')}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

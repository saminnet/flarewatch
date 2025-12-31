import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { IconX } from '@tabler/icons-react';
import type { MonitorState } from '@flarewatch/shared';
import { generateDailyStatus, formatDuration, type DailyStatusData } from '@/lib/uptime';
import { formatUtc } from '@/lib/date';
import { cn } from '@/lib/utils';

interface StatusBarProps {
  monitorId: string;
  monitorName?: string;
  state: MonitorState;
}

const statusColors = {
  up: 'bg-emerald-500 hover:bg-emerald-400',
  down: 'bg-red-500 hover:bg-red-400',
  partial: 'bg-amber-500 hover:bg-amber-400',
  unknown: 'bg-neutral-300 dark:bg-neutral-700 hover:bg-neutral-400 dark:hover:bg-neutral-600',
};

export function StatusBar({ monitorId, monitorName, state }: StatusBarProps) {
  const { t } = useTranslation();
  const [selectedDay, setSelectedDay] = useState<DailyStatusData | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const dailyStatus = useMemo(() => generateDailyStatus(monitorId, state), [monitorId, state]);

  const handleDayClick = (day: DailyStatusData) => {
    if (day.downtime > 0 && day.incidents.length > 0) {
      setSelectedDay(day);
      setModalOpen(true);
    }
  };

  return (
    <>
      <div className="flex items-center gap-0.5 overflow-hidden rounded">
        {dailyStatus.map((day, index) => (
          <Tooltip key={index}>
            <TooltipTrigger
              className={cn(
                'h-8 flex-1 min-w-0 rounded-sm transition-colors',
                statusColors[day.status],
                day.downtime > 0 ? 'cursor-pointer' : 'cursor-default',
              )}
              onClick={() => handleDayClick(day)}
            />
            <TooltipContent side="top" className="text-xs">
              <div className="font-medium">
                {day.status === 'unknown'
                  ? t('monitor.noData')
                  : t('monitor.percentAtDate', {
                      percent: day.uptime.toFixed(2),
                      date: formatUtc(day.date, 'MMM d, yyyy'),
                    })}
              </div>
              {day.downtime > 0 && (
                <div className="text-neutral-400">
                  {t('monitor.downFor', { duration: formatDuration(day.downtime) })}
                </div>
              )}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      {/* Incident Detail Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>
                {selectedDay &&
                  t('monitor.incidentsAt', {
                    name: monitorName || monitorId,
                    date: formatUtc(selectedDay.date, 'MMM d, yyyy'),
                  })}
              </DialogTitle>
              <DialogClose
                render={
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <IconX className="h-4 w-4" />
                  </Button>
                }
              />
            </div>
          </DialogHeader>

          <div className="space-y-2">
            {selectedDay?.incidents.map((incident, idx) => (
              <div
                key={idx}
                className="rounded-md border border-neutral-200 dark:border-neutral-800 p-3 text-sm"
              >
                <div className="font-mono text-xs text-neutral-500 mb-1">
                  [{incident.startTime} - {incident.endTime}]
                </div>
                <div className="text-neutral-700 dark:text-neutral-300">{incident.error}</div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

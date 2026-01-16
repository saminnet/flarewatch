import { memo, useState, useMemo, useCallback } from 'react';
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
import { generateDailyStatus, type DailyStatusData } from '@/lib/uptime';
import { formatUtc, formatDuration } from '@/lib/date';
import { cn } from '@/lib/utils';
import { useContainerWidth } from '@/lib/hooks/use-container-width';
import { STATUS_BAR } from '@/lib/constants';

const statusColors = {
  up: 'bg-emerald-500',
  down: 'bg-red-500',
  partial: 'bg-amber-500',
  unknown: 'bg-neutral-300 dark:bg-neutral-700',
};

const hoverColors = {
  up: 'hover:bg-emerald-400',
  down: 'hover:bg-red-400',
  partial: 'hover:bg-amber-400',
  unknown: 'hover:bg-neutral-400 dark:hover:bg-neutral-600',
};

interface StatusBarSegmentProps {
  day: DailyStatusData;
  isMobile: boolean;
  onClick: (day: DailyStatusData) => void;
}

const StatusBarSegment = memo(function StatusBarSegment({
  day,
  isMobile,
  onClick,
}: StatusBarSegmentProps) {
  const { t } = useTranslation();

  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={
          day.status === 'unknown'
            ? t('monitor.noDataAt', { date: formatUtc(day.date, 'MMM d, yyyy') })
            : t('monitor.statusAt', {
                percent: day.uptime.toFixed(2),
                date: formatUtc(day.date, 'MMM d, yyyy'),
              })
        }
        className={cn(
          'h-8 rounded-sm transition-all duration-150',
          isMobile ? 'w-2.5 shrink-0' : 'min-w-0 flex-1',
          statusColors[day.status],
          day.downtime > 0
            ? `cursor-pointer hover:scale-y-110 hover:brightness-110 ${hoverColors[day.status]}`
            : 'cursor-default',
        )}
        onClick={() => onClick(day)}
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
          <div className="text-neutral-500">
            {t('monitor.downFor', { duration: formatDuration(day.downtime) })}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
});

interface StatusBarProps {
  monitorId: string;
  monitorName?: string;
  state: MonitorState;
}

export function StatusBar({ monitorId, monitorName, state }: StatusBarProps) {
  const { t } = useTranslation();
  const [selectedDay, setSelectedDay] = useState<DailyStatusData | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const dailyStatus = useMemo(() => generateDailyStatus(monitorId, state), [monitorId, state]);

  const { ref, width, isReady } = useContainerWidth();

  const mobileBarCount = useMemo(() => {
    // calculate how many bars fit based on container width
    if (!isReady) return 0;
    return Math.min(Math.floor(width / STATUS_BAR.MOBILE_BAR_WIDTH), dailyStatus.length);
  }, [width, isReady, dailyStatus.length]);

  const mobileBars = useMemo(
    () => dailyStatus.slice(-mobileBarCount),
    [dailyStatus, mobileBarCount],
  );

  const handleDayClick = useCallback((day: DailyStatusData) => {
    if (day.downtime > 0 && day.incidents.length > 0) {
      setSelectedDay(day);
      setModalOpen(true);
    }
  }, []);

  return (
    <>
      {/* Desktop: all 90 bars with flex-1 */}
      <div className="hidden sm:flex items-center gap-0.5 overflow-hidden rounded">
        {dailyStatus.map((day) => (
          <StatusBarSegment
            key={day.date.toISOString()}
            day={day}
            isMobile={false}
            onClick={handleDayClick}
          />
        ))}
      </div>

      {/* Mobile: fewer bars with fixed width based on container */}
      <div ref={ref} className="flex sm:hidden items-center gap-0.5 overflow-hidden rounded">
        {mobileBars.map((day) => (
          <StatusBarSegment
            key={day.date.toISOString()}
            day={day}
            isMobile={true}
            onClick={handleDayClick}
          />
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
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    aria-label={t('action.close')}
                  >
                    <IconX className="h-4 w-4" />
                  </Button>
                }
              />
            </div>
          </DialogHeader>

          <div className="space-y-2">
            {selectedDay?.incidents.map((incident) => (
              <div
                key={`${incident.startTime}-${incident.endTime}`}
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

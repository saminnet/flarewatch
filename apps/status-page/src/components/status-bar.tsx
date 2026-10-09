import { useState } from 'react';
import { Tooltip, TooltipContent } from '@/components/ui/tooltip';
import { BarCell } from '@/components/ui/status-cell';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { IconX } from '@tabler/icons-react';
import type { StatusView } from '@flarewatch/shared';
import { formatPercent, generateDailyStatus, type DailyStatusData } from '@/lib/uptime';
import { formatUtc, formatDuration } from '@/lib/date';
import { cn } from '@/lib/utils';
import { useContainerWidth } from '@/lib/hooks/use-container-width';
import { STATUS_BAR } from '@/lib/constants';

interface StatusBarSegmentProps {
  day: DailyStatusData;
  isMobile: boolean;
  onClick: (day: DailyStatusData) => void;
}

function StatusBarSegment({ day, isMobile, onClick }: StatusBarSegmentProps) {
  return (
    <Tooltip>
      <BarCell
        aria-label={
          day.status === 'unknown'
            ? `No data for ${formatUtc(day.date, 'MMM d, yyyy')}`
            : `${formatPercent(day.uptime, 2)} uptime on ${formatUtc(day.date, 'MMM d, yyyy')}`
        }
        status={day.status}
        interactive={day.downtime > 0}
        className={cn('h-6', isMobile ? 'w-2.5 shrink-0' : 'min-w-0 flex-1')}
        onClick={() => onClick(day)}
      />
      <TooltipContent side="top">
        <div className="font-medium">
          {day.status === 'unknown'
            ? 'No data'
            : `${formatPercent(day.uptime, 2)} at ${formatUtc(day.date, 'MMM d, yyyy')}`}
        </div>
        {day.downtime > 0 && (
          <div className="text-muted-foreground">
            {`Down for ${formatDuration(day.downtime)} (click for detail)`}
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

interface StatusBarProps {
  monitorId: string;
  monitorName?: string;
  state: StatusView;
}

export function StatusBar({ monitorId, monitorName, state }: StatusBarProps) {
  const [selectedDay, setSelectedDay] = useState<DailyStatusData | null>(null);
  const dailyStatus = generateDailyStatus(monitorId, state);

  const { ref, width, isReady } = useContainerWidth();

  const mobileBarCount = isReady
    ? Math.min(Math.floor(width / STATUS_BAR.MOBILE_BAR_WIDTH), dailyStatus.length)
    : 0;

  const mobileBars = dailyStatus.slice(-mobileBarCount);

  function handleDayClick(day: DailyStatusData) {
    if (day.downtime > 0 && day.incidents.length > 0) {
      setSelectedDay(day);
    }
  }

  return (
    <>
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

      <Dialog open={!!selectedDay} onOpenChange={(open) => !open && setSelectedDay(null)}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle>
                {selectedDay &&
                  `${monitorName || monitorId} incidents at ${formatUtc(selectedDay.date, 'MMM d, yyyy')}`}
              </DialogTitle>
              <DialogClose
                render={
                  <Button variant="ghost" size="icon-sm" aria-label="Close">
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
                className="rounded-md border border-border p-3 text-sm"
              >
                <div className="font-mono text-xs text-muted-foreground mb-1">
                  [{incident.startTime} - {incident.endTime}]
                </div>
                <div className="text-foreground">{incident.error}</div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

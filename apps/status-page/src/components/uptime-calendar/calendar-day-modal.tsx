import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { IconX } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { formatUtc } from '@/lib/date';
import type { AggregatedDayData, AggregatedDayIncident } from '@/lib/uptime';
import { STATUS_DOT_COLORS } from '@/lib/constants';

function groupByMonitor(incidents: AggregatedDayIncident[]): Map<string, AggregatedDayIncident[]> {
  const grouped = new Map<string, AggregatedDayIncident[]>();
  for (const incident of incidents) {
    const existing = grouped.get(incident.monitorName);
    if (existing) {
      existing.push(incident);
    } else {
      grouped.set(incident.monitorName, [incident]);
    }
  }
  return grouped;
}

interface CalendarDayModalProps {
  data: AggregatedDayData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CalendarDayModal({ data, open, onOpenChange }: CalendarDayModalProps) {
  const { t } = useTranslation();

  if (!data) return null;

  const grouped = groupByMonitor(data.incidents);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <span
                className={cn('w-2.5 h-2.5 rounded-full shrink-0', STATUS_DOT_COLORS[data.status])}
              />
              {t('calendar.incidentsOnDate', { date: formatUtc(data.date, 'MMM d, yyyy') })}
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
          {data.uptime !== null && (
            <DialogDescription>
              {t('calendar.overallUptime', { percent: data.uptime.toFixed(2) })}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto space-y-4">
          {[...grouped.entries()].map(([monitorName, incidents]) => (
            <div key={monitorName}>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                {monitorName}
              </div>
              <div className="space-y-2">
                {incidents.map((incident, i) => (
                  <div
                    key={`${incident.startTime}-${incident.endTime}-${i}`}
                    className="rounded-md border border-border p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                        [{incident.startTime} – {incident.endTime}]
                      </span>
                      <span className="text-sm text-foreground text-right">{incident.error}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

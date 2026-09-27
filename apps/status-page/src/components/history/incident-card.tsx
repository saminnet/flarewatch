import { IconAlertTriangle } from '@tabler/icons-react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { DateRange } from './date-range';
import type { IncidentEvent } from './types';

interface IncidentCardProps {
  event: IncidentEvent;
}

export function IncidentCard({ event }: IncidentCardProps) {
  const startDate = new Date(event.start * 1000);
  const endDate = event.end ? new Date(event.end * 1000) : null;
  const isOngoing = !event.end;
  const latestError = event.errors.at(-1) ?? 'Unknown error';

  return (
    <Alert className="bg-status-down-bg">
      <AlertTitle className="flex flex-wrap items-center gap-2">
        <IconAlertTriangle className="h-4 w-4 text-status-down" />
        {event.monitorName}
        <Badge variant="outline" className="text-xs">
          Incident
        </Badge>
        {isOngoing && (
          <Badge variant="destructive" className="text-xs">
            Ongoing
          </Badge>
        )}
      </AlertTitle>

      <AlertDescription className="mt-1.5">
        <p className="text-foreground">{latestError}</p>
        <DateRange
          start={startDate}
          end={endDate}
          noEndLabel="Ongoing"
          noEndClassName="text-status-down"
        />
      </AlertDescription>
    </Alert>
  );
}

import { useTranslation } from 'react-i18next';
import { IconAlertTriangle } from '@tabler/icons-react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { DateRange } from './date-range';
import type { IncidentEvent } from './types';

interface IncidentCardProps {
  event: IncidentEvent;
}

export function IncidentCard({ event }: IncidentCardProps) {
  const { t } = useTranslation();
  const startDate = new Date(event.start * 1000);
  const endDate = event.end ? new Date(event.end * 1000) : null;
  const isOngoing = !event.end;
  const latestError = event.errors.at(-1) ?? t('error.unknown');

  return (
    <Alert className="bg-status-down-bg">
      <AlertTitle className="flex items-center gap-2">
        <IconAlertTriangle className="h-4 w-4 text-status-down" />
        {event.monitorName}
        <Badge variant="outline" className="text-xs">
          {t('event.incident')}
        </Badge>
        {isOngoing && (
          <Badge variant="destructive" className="text-xs">
            {t('status.ongoing')}
          </Badge>
        )}
      </AlertTitle>

      <AlertDescription className="mt-1.5">
        <p className="text-foreground">{latestError}</p>
        <DateRange
          start={startDate}
          end={endDate}
          noEndLabel={t('status.ongoing')}
          noEndClassName="text-status-down"
        />
      </AlertDescription>
    </Alert>
  );
}

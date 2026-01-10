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
    <Alert className="border-l-4 border-red-500 bg-red-50 dark:bg-red-950/30">
      <AlertTitle className="flex items-center gap-2">
        <IconAlertTriangle className="h-4 w-4 text-red-500" />
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

      <AlertDescription className="mt-2">
        <p className="text-neutral-700 dark:text-neutral-300">{latestError}</p>
        <DateRange
          start={startDate}
          end={endDate}
          noEndLabel={t('status.ongoing')}
          noEndClassName="text-red-500"
        />
      </AlertDescription>
    </Alert>
  );
}

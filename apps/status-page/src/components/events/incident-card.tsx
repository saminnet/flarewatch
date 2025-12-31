import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { IconAlertTriangle } from '@tabler/icons-react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { IncidentEvent } from './types';

interface IncidentCardProps {
  event: IncidentEvent;
}

export function IncidentCard({ event }: IncidentCardProps) {
  const { t } = useTranslation();
  const startDate = new Date(event.start * 1000);
  const endDate = event.end ? new Date(event.end * 1000) : null;
  const isOngoing = !event.end;
  const latestError = event.errors[event.errors.length - 1] ?? t('error.unknown');

  return (
    <Alert className="border-l-4 border-red-500 bg-red-50 dark:bg-red-950/30">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
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

            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-neutral-500">
              <span>
                <strong>{t('field.from')}</strong> {format(startDate, 'PPp')}
              </span>
              {endDate ? (
                <span>
                  <strong>{t('field.to')}</strong> {format(endDate, 'PPp')}
                </span>
              ) : (
                <span className="text-red-500">{t('status.ongoing')}</span>
              )}
            </div>
          </AlertDescription>
        </div>
      </div>
    </Alert>
  );
}

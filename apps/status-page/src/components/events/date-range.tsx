import { useTranslation } from 'react-i18next';
import { formatUtc } from '@/lib/date';

interface DateRangeProps {
  start: Date;
  end: Date | null;
  noEndLabel: string;
  noEndClassName?: string;
}

export function DateRange({ start, end, noEndLabel, noEndClassName }: DateRangeProps) {
  const { t } = useTranslation();

  return (
    <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-neutral-500">
      <span>
        <strong>{t('field.from')}</strong> {formatUtc(start, 'PPp')}
      </span>
      {end ? (
        <span>
          <strong>{t('field.to')}</strong> {formatUtc(end, 'PPp')}
        </span>
      ) : (
        <span className={noEndClassName}>{noEndLabel}</span>
      )}
    </div>
  );
}

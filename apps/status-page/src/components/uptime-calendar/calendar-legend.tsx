import { useTranslation } from 'react-i18next';
import { STATUS_COLORS } from '@/lib/constants';

const legendItems = [
  { key: 'calendar.operational', color: STATUS_COLORS.up },
  { key: 'calendar.partial', color: STATUS_COLORS.partial },
  { key: 'calendar.down', color: STATUS_COLORS.down },
] as const;

export function CalendarLegend() {
  const { t } = useTranslation();

  return (
    <ul className="flex items-center gap-3 mt-3 list-none p-0 m-0">
      {legendItems.map((item) => (
        <li key={item.key} className="flex items-center gap-1">
          <div className={`size-2 rounded-sm ${item.color}`} />
          <span className="text-[10px] text-muted-foreground">{t(item.key)}</span>
        </li>
      ))}
      <li className="flex items-center gap-1">
        <div className="size-2 rounded-full bg-neutral-500 ring-1 ring-white/90 dark:bg-neutral-400 dark:ring-neutral-950" />
        <span className="text-[10px] text-muted-foreground">{t('calendar.incident')}</span>
      </li>
      <li className="flex items-center gap-1">
        <div className={`size-2 rounded-sm ${STATUS_COLORS.unknown}`} />
        <span className="text-[10px] text-muted-foreground">{t('calendar.noData')}</span>
      </li>
    </ul>
  );
}

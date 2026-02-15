import { useTranslation } from 'react-i18next';
import { STATUS_COLORS } from '@/lib/constants';

const legendItems = [
  { key: 'calendar.operational', color: STATUS_COLORS.up },
  { key: 'calendar.partial', color: STATUS_COLORS.partial },
  { key: 'calendar.down', color: STATUS_COLORS.down },
  { key: 'calendar.noData', color: STATUS_COLORS.unknown },
] as const;

export function CalendarLegend() {
  const { t } = useTranslation();

  return (
    <ul className="flex items-center gap-3 mt-3 list-none p-0 m-0">
      {legendItems.map((item) => (
        <li key={item.key} className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-sm ${item.color}`} />
          <span className="text-[10px] text-muted-foreground">{t(item.key)}</span>
        </li>
      ))}
    </ul>
  );
}

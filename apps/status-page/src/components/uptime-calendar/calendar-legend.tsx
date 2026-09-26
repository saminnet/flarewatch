import { STATUS_COLORS } from '@/lib/constants';

const legendItems = [
  { label: 'Operational', color: STATUS_COLORS.up },
  { label: 'Partial outage', color: STATUS_COLORS.partial },
  { label: 'Major outage', color: STATUS_COLORS.down },
] as const;

export function CalendarLegend() {
  return (
    <ul className="flex items-center gap-3 mt-3 list-none p-0 m-0">
      {legendItems.map((item) => (
        <li key={item.label} className="flex items-center gap-1">
          <div className={`size-2 rounded-sm ${item.color}`} />
          <span className="text-[10px] text-muted-foreground">{item.label}</span>
        </li>
      ))}
      <li className="flex items-center gap-1">
        <div className="size-2 rounded-full bg-muted-foreground ring-1 ring-background/90" />
        <span className="text-[10px] text-muted-foreground">Incident</span>
      </li>
      <li className="flex items-center gap-1">
        <div className={`size-2 rounded-sm ${STATUS_COLORS.unknown}`} />
        <span className="text-[10px] text-muted-foreground">No data</span>
      </li>
    </ul>
  );
}

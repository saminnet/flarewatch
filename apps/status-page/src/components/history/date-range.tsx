import { formatUtcShort } from '@flarewatch/shared';

interface DateRangeProps {
  start: Date;
  end: Date | null;
  noEndLabel: string;
  noEndClassName?: string;
}

export function DateRange({ start, end, noEndLabel, noEndClassName }: DateRangeProps) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      <span>
        <strong>From</strong> {formatUtcShort(start.getTime() / 1000)}
      </span>
      {end ? (
        <span>
          <strong>To</strong> {formatUtcShort(end.getTime() / 1000)}
        </span>
      ) : (
        <span className={noEndClassName}>{noEndLabel}</span>
      )}
    </div>
  );
}

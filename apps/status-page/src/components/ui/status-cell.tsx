import type { ComponentProps } from 'react';
import type { HeartbeatRun } from '@flarewatch/shared';
import { cva, type VariantProps } from 'class-variance-authority';

import { TooltipTrigger } from '@/components/ui/tooltip';
import { STATUS_COLORS, STATUS_DOT_COLORS } from '@/lib/constants';
import { cn } from '@/lib/utils';

export const RUN_CELL_CLASSES: Record<HeartbeatRun['outcome'], string> = {
  ok: 'bg-status-operational',
  late: 'bg-status-degraded',
  fail: 'bg-status-down',
  miss: 'bg-status-down/40 border border-dashed border-status-down',
};

export const RUNNING_CELL_CLASSES = 'border border-status-maintenance';

const NEXT_CELL = 'border border-dashed';

const barCellVariants = cva(
  'rounded-sm transition-[scale,filter,background-color,box-shadow] duration-150 ease-out',
  {
    variants: {
      status: STATUS_DOT_COLORS,
      interactive: {
        true: 'cursor-pointer hover:scale-y-110 hover:brightness-110',
        false: 'cursor-default',
      },
    },
  },
);

function BarCell({
  className,
  status,
  interactive,
  ...props
}: ComponentProps<typeof TooltipTrigger> & VariantProps<typeof barCellVariants>) {
  return (
    <TooltipTrigger
      className={cn(barCellVariants({ status, interactive }), className)}
      {...props}
    />
  );
}

const runCellVariants = cva(
  'rounded-sm transition-[scale,filter,box-shadow] duration-150 ease-out hover:scale-y-110 hover:brightness-110 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
  {
    variants: {
      run: {
        ...RUN_CELL_CLASSES,
        running: `${RUNNING_CELL_CLASSES} bg-[linear-gradient(to_top,var(--status-maintenance)_45%,var(--status-maintenance-bg)_45%)]`,
      },
      next: {
        next: `${NEXT_CELL} bg-status-unknown-bg border-muted-foreground`,
        late: `${NEXT_CELL} bg-status-degraded/40 border-status-degraded-text`,
        missed: `${NEXT_CELL} bg-status-down/40 border-status-down`,
        first: `${NEXT_CELL} bg-status-unknown-bg border-muted-foreground`,
        running: `${NEXT_CELL} bg-status-maintenance/40 border-status-maintenance`,
      },
    },
  },
);

function RunCell({
  className,
  run,
  next,
  ...props
}: ComponentProps<typeof TooltipTrigger> & VariantProps<typeof runCellVariants>) {
  return <TooltipTrigger className={cn(runCellVariants({ run, next }), className)} {...props} />;
}

const dayCellVariants = cva(
  'rounded text-2xs leading-none tabular-nums font-medium animate-calendar-cell transition-all duration-150 hover:brightness-110',
  {
    variants: {
      // Overlays are tuned for contrast on the solid status fills.
      status: {
        up: `${STATUS_COLORS.up} text-background/70`,
        down: `${STATUS_COLORS.down} text-background/80`,
        partial: `${STATUS_COLORS.partial} text-status-degraded-text/50 dark:text-foreground/70`,
        unknown: `${STATUS_COLORS.unknown} text-muted-foreground`,
      },
      today: {
        true: 'ring-2 ring-foreground/40 ring-offset-1 ring-offset-background',
      },
    },
  },
);

function DayCell({
  className,
  status,
  today,
  ...props
}: ComponentProps<typeof TooltipTrigger> & VariantProps<typeof dayCellVariants>) {
  return (
    <TooltipTrigger className={cn(dayCellVariants({ status, today }), className)} {...props} />
  );
}

export { BarCell, RunCell, DayCell };

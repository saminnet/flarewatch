import { cva, type VariantProps } from 'class-variance-authority';

import { Badge } from '@/components/ui/badge';
import { UPTIME_TEXT } from '@/lib/color';
import { cn } from '@/lib/utils';

const uptimeBadgeVariants = cva('font-mono', {
  variants: {
    tone: {
      operational: `${UPTIME_TEXT.operational} border-status-operational`,
      degraded: `${UPTIME_TEXT.degraded} border-status-degraded`,
      down: `${UPTIME_TEXT.down} border-status-down`,
      unknown: `${UPTIME_TEXT.unknown} border-status-unknown`,
      pending: `${UPTIME_TEXT.pending} border-border`,
    },
  },
});

function UptimeBadge({
  tone,
  className,
  ...props
}: React.ComponentProps<typeof Badge> & VariantProps<typeof uptimeBadgeVariants>) {
  return (
    <Badge variant="outline" className={cn(uptimeBadgeVariants({ tone }), className)} {...props} />
  );
}

export { UptimeBadge };

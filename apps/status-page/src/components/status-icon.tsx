import {
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconClockExclamation,
  IconProgress,
} from '@tabler/icons-react';
import type { MonitorState } from '@/lib/monitor-state';
import { cn } from '@/lib/utils';

interface StatusIconProps {
  state: MonitorState;
  className?: string;
}

const STATE_ICONS = {
  up: [IconCircleCheck, 'text-status-operational'],
  degraded: [IconClockExclamation, 'text-status-degraded-text'],
  pending: [IconCircleDashed, 'text-muted-foreground'],
  running: [IconProgress, 'text-status-maintenance'],
  down: [IconCircleX, 'text-status-down'],
} as const;

export function StatusIcon({ state, className }: StatusIconProps) {
  const [Icon, color] = STATE_ICONS[state];
  return <Icon aria-hidden="true" className={cn('h-5 w-5', color, className)} />;
}

import {
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconClockExclamation,
  IconProgress,
} from '@tabler/icons-react';
import type { HeartbeatStatus } from '@flarewatch/shared';
import { cn } from '@/lib/utils';

interface StatusIconProps {
  isUp: boolean;
  phase?: HeartbeatStatus;
  className?: string;
}

const PHASE_ICONS = {
  up: [IconCircleCheck, 'text-status-operational'],
  late: [IconClockExclamation, 'text-status-degraded-text'],
  pending: [IconCircleDashed, 'text-muted-foreground'],
  running: [IconProgress, 'text-status-maintenance'],
  down: [IconCircleX, 'text-status-down'],
} as const;

export function StatusIcon({ isUp, phase, className }: StatusIconProps) {
  const [Icon, color] = PHASE_ICONS[phase ?? (isUp ? 'up' : 'down')];
  return <Icon aria-hidden="true" className={cn('h-5 w-5', color, className)} />;
}

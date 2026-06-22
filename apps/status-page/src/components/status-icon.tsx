import { IconCircleCheck, IconCircleX } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

interface StatusIconProps {
  isUp: boolean;
  className?: string;
}

export function StatusIcon({ isUp, className }: StatusIconProps) {
  return isUp ? (
    <IconCircleCheck className={cn('h-5 w-5 text-status-operational', className)} />
  ) : (
    <IconCircleX className={cn('h-5 w-5 text-status-down', className)} />
  );
}

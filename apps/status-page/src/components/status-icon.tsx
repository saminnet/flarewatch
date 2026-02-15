import { IconCircleCheck, IconCircleX } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

interface StatusIconProps {
  isUp: boolean;
  className?: string;
}

export function StatusIcon({ isUp, className }: StatusIconProps) {
  return isUp ? (
    <IconCircleCheck className={cn('h-5 w-5 text-emerald-500', className)} />
  ) : (
    <IconCircleX className={cn('h-5 w-5 text-red-500', className)} />
  );
}

import { cn } from '@/lib/utils';
import { Card } from './card';

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  iconClassName?: string;
  iconContainerClassName?: string;
  title: string;
  description?: string;
}

export function EmptyState({
  icon: Icon,
  iconClassName = 'text-neutral-500',
  iconContainerClassName = 'bg-neutral-100 dark:bg-neutral-800',
  title,
  description,
}: EmptyStateProps) {
  return (
    <Card className="p-8 text-center">
      <div
        className={cn(
          'mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full',
          iconContainerClassName,
        )}
      >
        <Icon className={cn('h-6 w-6', iconClassName)} />
      </div>
      <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">{title}</h3>
      {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
    </Card>
  );
}

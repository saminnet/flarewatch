import { cn } from '@/lib/utils';
import { Card } from './card';

const TONES = {
  default: { icon: 'text-muted-foreground', container: 'bg-muted' },
  operational: { icon: 'text-status-operational', container: 'bg-status-operational-bg' },
};

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof TONES;
  title: string;
  description?: string;
}

export function EmptyState({ icon: Icon, tone = 'default', title, description }: EmptyStateProps) {
  return (
    <Card className="p-8 text-center">
      <div
        className={cn(
          'mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full',
          TONES[tone].container,
        )}
      >
        <Icon className={cn('h-6 w-6', TONES[tone].icon)} />
      </div>
      <h3 className="text-lg font-medium text-foreground">{title}</h3>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </Card>
  );
}

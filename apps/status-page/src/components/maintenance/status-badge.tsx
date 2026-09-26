import { Badge } from '@/components/ui/badge';

type MaintenanceStatus = 'active' | 'upcoming' | 'scheduled' | 'past';

const STATUS_CONFIG = {
  active: { variant: 'secondary', label: 'Ongoing' },
  upcoming: { variant: 'secondary', label: 'Upcoming' },
  scheduled: { variant: 'secondary', label: 'Upcoming' },
  past: { variant: 'outline', label: 'Completed' },
} as const;

interface MaintenanceStatusBadgeProps {
  status: MaintenanceStatus;
}

export function MaintenanceStatusBadge({ status }: MaintenanceStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

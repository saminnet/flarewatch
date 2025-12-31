import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

type MaintenanceStatus = 'active' | 'upcoming' | 'past';

const STATUS_CONFIG = {
  active: { variant: 'secondary', key: 'status.ongoing' },
  upcoming: { variant: 'secondary', key: 'status.upcoming' },
  past: { variant: 'outline', key: 'status.completed' },
} as const;

interface MaintenanceStatusBadgeProps {
  status: MaintenanceStatus;
}

export function MaintenanceStatusBadge({ status }: MaintenanceStatusBadgeProps) {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[status];
  return <Badge variant={config.variant}>{t(config.key)}</Badge>;
}

import { createServerFn } from '@tanstack/react-start';
import { getConfig } from '@/lib/config';
import { requireOperator } from '@/lib/operator.server';
import {
  publicView,
  toAdminMonitors,
  type AdminMonitor,
  type PublicMonitor,
} from '@/lib/public-view';

export const getPublicMonitors = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PublicMonitor[]> => {
    const config = await getConfig();
    return publicView(config, null).monitors;
  },
);

export const getAdminMonitors = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AdminMonitor[]> => {
    await requireOperator();
    const config = await getConfig();
    return toAdminMonitors(config);
  },
);

import { createServerFn } from '@tanstack/react-start';
import { getConfig } from '@/lib/config';
import { requireAdminAuthenticated } from '@/lib/admin-auth.server';
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
    await requireAdminAuthenticated();
    const config = await getConfig();
    return toAdminMonitors(config);
  },
);

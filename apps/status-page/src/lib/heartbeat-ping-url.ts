import { createServerFn } from '@tanstack/react-start';
import { getRequestUrl } from '@tanstack/react-start/server';
import { requireAdminAuthenticated } from '@/lib/admin-auth.server';
import { fetchPingUrl } from '@/lib/heartbeat';
import { resolveRuntimeEnv } from '@/lib/runtime-env';

/** Ping URL for one heartbeat monitor. Admin only; the secret stays in the monitoring worker. */
export const getHeartbeatPingUrl = createServerFn({ method: 'GET' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<string | null> => {
    await requireAdminAuthenticated();
    const env = await resolveRuntimeEnv();
    return fetchPingUrl(env.MONITOR_WORKER, getRequestUrl().origin, data.id);
  });

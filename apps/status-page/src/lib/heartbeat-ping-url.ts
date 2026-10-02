import { createServerFn } from '@tanstack/react-start';
import { getRequestUrl } from '@tanstack/react-start/server';
import { requireOperator } from '@/lib/operator.server';
import { fetchPingUrl } from '@/lib/monitor-worker';

/** Ping URL for one heartbeat monitor. Admin only; the secret stays in the monitoring worker. */
export const getHeartbeatPingUrl = createServerFn({ method: 'GET' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<string | null> => {
    await requireOperator();
    return fetchPingUrl(getRequestUrl().origin, data.id);
  });

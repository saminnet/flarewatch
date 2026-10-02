import type { StatusView } from '@flarewatch/shared';
import { calculateUptimePercent, getMonitorError, getLatestLatency } from '@/lib/uptime';
import { getStatusColor } from '@/lib/color';

export function useMonitorStatus(monitorId: string, state: StatusView) {
  const uptimePercent = calculateUptimePercent(monitorId, state);
  return {
    uptimePercent,
    error: getMonitorError(monitorId, state),
    latency: getLatestLatency(monitorId, state),
    statusColor: getStatusColor(uptimePercent),
  };
}

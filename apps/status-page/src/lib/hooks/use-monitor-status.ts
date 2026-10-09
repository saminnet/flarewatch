import type { StatusView } from '@flarewatch/shared';
import { calculateUptimePercent, getMonitorError, getLatestLatency } from '@/lib/uptime';

export function useMonitorStatus(monitorId: string, state: StatusView) {
  return {
    uptimePercent: calculateUptimePercent(monitorId, state),
    error: getMonitorError(monitorId, state),
    latency: getLatestLatency(monitorId, state),
  };
}

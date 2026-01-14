import { useMemo } from 'react';
import type { MonitorState } from '@flarewatch/shared';
import {
  calculateUptimePercent,
  isMonitorUp,
  getMonitorError,
  getLatestLatency,
} from '@/lib/uptime';
import { getStatusColor } from '@/lib/color';

export function useMonitorStatus(monitorId: string, state: MonitorState) {
  return useMemo(() => {
    const uptimePercent = calculateUptimePercent(monitorId, state);
    return {
      isUp: isMonitorUp(monitorId, state),
      uptimePercent,
      error: getMonitorError(monitorId, state),
      latency: getLatestLatency(monitorId, state),
      statusColor: getStatusColor(uptimePercent),
    };
  }, [monitorId, state]);
}

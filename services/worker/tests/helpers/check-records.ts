import type { CheckResult, MonitorTarget } from '@flarewatch/shared';
import type { CheckRecord } from '../../src/hub/monitor-hub';
import { createMonitor } from '@flarewatch/shared/testing/monitors';

export const up = (latency = 10): CheckResult => ({ ok: true, latency });
export const down = (error = 'Unavailable'): CheckResult => ({ ok: false, error });

export function check(
  id: string,
  result: CheckResult,
  location = 'HEL',
): CheckRecord & { monitor: MonitorTarget } {
  return {
    monitor: createMonitor({ id, name: id, target: `https://${id}.example.com` }),
    check: { location, result },
  };
}

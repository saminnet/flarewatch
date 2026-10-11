import type { CheckResult, MonitorTarget } from '@flarewatch/shared';
import type { CheckRecord } from '../../src/hub/monitor-hub';
import { createMonitor } from '../../../../packages/shared/tests/helpers/monitors';

export const up = (latency = 10): CheckResult => ({ ok: true, latency });
export const down = (error = 'Unavailable'): CheckResult => ({ ok: false, error });

/** A check run's record of the monitor `id`, checked from `location`. */
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

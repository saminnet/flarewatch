import type { CheckResultWithLocation, MonitorTarget } from '@flarewatch/shared';
import { getEdgeLocation } from '../utils/location';
import { httpChecker } from './http';
import { tcpChecker } from './tcp';

export async function checkDirectMonitor(target: MonitorTarget): Promise<CheckResultWithLocation> {
  const location = await getEdgeLocation();

  if (target.method === 'TCP_PING') {
    const result = await tcpChecker.check(target);
    return { location, result };
  }

  const result = await httpChecker.check(target);
  return { location, result };
}

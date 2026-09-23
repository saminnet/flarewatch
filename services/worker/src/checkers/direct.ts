import type { CheckResultWithLocation, MonitorTarget } from '@flarewatch/shared';
import { defaultCheckDeps, type CheckDeps } from './deps';

export async function checkDirectMonitor(
  target: MonitorTarget,
  deps: CheckDeps = defaultCheckDeps,
): Promise<CheckResultWithLocation> {
  const location = await deps.getEdgeLocation();
  const checker = target.method === 'TCP_PING' ? deps.tcp : deps.http;
  const result = await checker.check(target);
  return { location, result };
}

import { type MonitorTarget, type CheckResultWithLocation, failure } from '@flarewatch/shared';
import { getEdgeLocation } from '../utils/location';
import { checkDirectMonitor } from './direct';
import { checkExternalProxy } from './proxy';
import { globalPingChecker } from './globalping';

function shouldFallbackToDirect(target: MonitorTarget, result: CheckResultWithLocation): boolean {
  return Boolean(target.checkProxyFallback && !result.result.ok);
}

export async function checkMonitor(
  target: MonitorTarget,
  env?: { FLAREWATCH_PROXY_TOKEN?: string },
): Promise<CheckResultWithLocation> {
  if (target.checkProxy?.startsWith('globalping://')) {
    const result = await globalPingChecker.check(target);
    return shouldFallbackToDirect(target, result) ? checkDirectMonitor(target) : result;
  }

  if (target.checkProxy?.startsWith('worker://')) {
    if (target.checkProxyFallback) {
      return checkDirectMonitor(target);
    }

    const location = await getEdgeLocation();
    return {
      location,
      result: failure('worker:// checkProxy is not supported'),
    };
  }

  if (target.checkProxy) {
    const result = await checkExternalProxy(target, env);
    return shouldFallbackToDirect(target, result) ? checkDirectMonitor(target) : result;
  }

  return checkDirectMonitor(target);
}

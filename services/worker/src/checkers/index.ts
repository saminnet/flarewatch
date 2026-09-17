import { type MonitorTarget, type CheckResultWithLocation, failure } from '@flarewatch/shared';
import { defaultCheckDeps, type CheckDeps } from './deps';
import { checkDirectMonitor } from './direct';
import { checkExternalProxy } from './proxy';

function shouldFallbackToDirect(target: MonitorTarget, result: CheckResultWithLocation): boolean {
  return Boolean(target.checkProxyFallback && !result.result.ok);
}

export async function checkMonitor(
  target: MonitorTarget,
  env?: { FLAREWATCH_PROXY_TOKEN?: string },
  deps: CheckDeps = defaultCheckDeps,
): Promise<CheckResultWithLocation> {
  if (target.checkProxy?.startsWith('globalping://')) {
    const result = await deps.globalPing.check(target);
    return shouldFallbackToDirect(target, result) ? checkDirectMonitor(target, deps) : result;
  }

  if (target.checkProxy?.startsWith('worker://')) {
    if (target.checkProxyFallback) {
      return checkDirectMonitor(target, deps);
    }

    const location = await deps.getEdgeLocation();
    return {
      location,
      result: failure('worker:// checkProxy is not supported'),
    };
  }

  if (target.checkProxy) {
    const result = await checkExternalProxy(target, env, deps.fetcher);
    return shouldFallbackToDirect(target, result) ? checkDirectMonitor(target, deps) : result;
  }

  return checkDirectMonitor(target, deps);
}

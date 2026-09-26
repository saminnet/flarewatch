import {
  type CheckContext,
  type CheckResultWithLocation,
  type Monitor,
  type MonitorCheckResult,
  type MonitorTarget,
  failure,
} from '@flarewatch/shared';
import { defaultCheckDeps, type CheckDeps } from './deps';
import { checkDirectMonitor } from './direct';
import { checkHeartbeat } from './heartbeat';
import { checkExternalProxy } from './proxy';

function shouldFallbackToDirect(target: MonitorTarget, result: CheckResultWithLocation): boolean {
  return Boolean(target.checkProxyFallback && !result.result.ok);
}

export function checkMonitor(
  target: MonitorTarget,
  ctx: CheckContext,
  deps?: CheckDeps,
): Promise<CheckResultWithLocation>;
export function checkMonitor(
  target: Monitor,
  ctx: CheckContext,
  deps?: CheckDeps,
): Promise<MonitorCheckResult>;
export async function checkMonitor(
  target: Monitor,
  ctx: CheckContext,
  deps: CheckDeps = defaultCheckDeps,
): Promise<MonitorCheckResult> {
  if (target.method === 'HEARTBEAT') {
    return checkHeartbeat(target, ctx);
  }

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
    const result = await checkExternalProxy(target, ctx.env, deps.fetcher);
    return shouldFallbackToDirect(target, result) ? checkDirectMonitor(target, deps) : result;
  }

  return checkDirectMonitor(target, deps);
}

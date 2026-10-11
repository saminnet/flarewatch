import {
  fetchWithTimeout,
  type Fetcher,
  type MonitorTarget,
  type Webhook,
  type WorkerConfig,
} from '@flarewatch/shared';
import { checkMonitor, runBudget } from '../../../src/checkers/index';
import { defaultCheckDeps, type CheckDeps } from '../../../src/checkers/deps';
import { GlobalPingChecker } from '../../../src/checkers/globalping';
import { MonitorHub, runChecks } from '../../../src/index';
import { createNotifier, formatNotificationMessage } from '../../../src/notifications/webhook';
import { notificationContext } from '../../helpers/notification-context';

export { MonitorHub };

interface Bindings {
  MONITOR_HUB: DurableObjectNamespace<MonitorHub>;
}

/** Sends each https request to `origin` instead, the host becoming the first path segment. */
function internetAt(origin: string): Fetcher {
  return (input, options) => fetchWithTimeout(input.replace(/^https:\/\//, `${origin}/`), options);
}

/** The checkers, with every https request sent to `internet` when it is set. */
function checkDeps(internet: string | null): CheckDeps {
  // The default asks Cloudflare over the network where the Worker runs.
  const deps = { ...defaultCheckDeps, getEdgeLocation: async () => 'TEST' };
  if (internet === null) return deps;
  const fetcher = internetAt(internet);
  return { ...deps, fetcher, globalPing: new GlobalPingChecker(fetcher) };
}

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const { pathname, searchParams } = new URL(request.url);
    const deps = checkDeps(searchParams.get('internet'));
    if (pathname === '/webhook') {
      const { webhook, monitor }: { webhook: Webhook; monitor: MonitorTarget } =
        await request.json();
      const ctx = notificationContext({
        monitor,
        incidentStartTime: 0,
        currentTime: 0,
        reason: 'Timeout',
      });
      const [result] = await createNotifier(webhook)!.send(ctx, formatNotificationMessage(ctx));
      return Response.json(result);
    }
    if (pathname === '/run') {
      const { hub, config }: { hub: string; config: WorkerConfig } = await request.json();
      const namespace = { getByName: () => env.MONITOR_HUB.getByName(hub) };
      // SAFETY: runChecks reaches the hub only through getByName.
      const hubEnv = {
        MONITOR_HUB: namespace as typeof namespace & DurableObjectNamespace<MonitorHub>,
      };
      await runChecks(hubEnv, {
        checkMonitor: (target, ctx) => checkMonitor(target, ctx, deps),
        createNotifier,
        getEdgeLocation: deps.getEdgeLocation,
        staticConfig: config,
      });
      return Response.json(await env.MONITOR_HUB.getByName(hub).view());
    }
    const monitor: MonitorTarget = await request.json();
    const { result } = await checkMonitor(
      monitor,
      { env: {}, budget: runBudget([monitor], 0) },
      deps,
    );
    return Response.json(result);
  },
};

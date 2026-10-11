import { fetchWithTimeout, type MonitorTarget, type Webhook } from '@flarewatch/shared';
import { checkMonitor, runBudget } from '../../../src/checkers/index';
import { defaultCheckDeps } from '../../../src/checkers/deps';
import { GlobalPingChecker } from '../../../src/checkers/globalping';
import {
  createNotifier,
  formatNotificationMessage,
  type NotificationContext,
} from '../../../src/notifications/webhook';

// The default asks Cloudflare over the network where the Worker runs.
const deps = { ...defaultCheckDeps, getEdgeLocation: async () => 'TEST' };

function globalPingAt(origin: string): GlobalPingChecker {
  return new GlobalPingChecker((input, options) =>
    fetchWithTimeout(input.replace('https://api.globalping.io', origin), options),
  );
}

export default {
  async fetch(request: Request): Promise<Response> {
    const { pathname, searchParams } = new URL(request.url);
    if (pathname === '/webhook') {
      const { webhook, monitor }: { webhook: Webhook; monitor: MonitorTarget } =
        await request.json();
      const ctx: NotificationContext = {
        monitor,
        kind: 'down',
        incidentStartTime: 0,
        currentTime: 0,
        downtimeSeconds: 0,
        reason: 'Timeout',
        timeZone: 'UTC',
        alsoDown: [],
      };
      const [result] = await createNotifier(webhook)!.send(ctx, formatNotificationMessage(ctx));
      return Response.json(result);
    }
    const monitor: MonitorTarget = await request.json();
    const globalping = searchParams.get('globalping');
    const { result } = await checkMonitor(
      monitor,
      { env: {}, budget: runBudget([monitor], 0) },
      globalping ? { ...deps, globalPing: globalPingAt(globalping) } : deps,
    );
    return Response.json(result);
  },
};

import {
  type CheckContext,
  createLogger,
  type CheckResultWithLocation,
  type MonitorTarget,
  parseSecretWebhooks,
  type Webhook,
  type WorkerConfig,
} from '@flarewatch/shared';
import { workerConfig } from '@flarewatch/config/worker';

import { CHECK_NOW_PREFIX, handleCheckNow } from './check-now';
import { getHub, type Env } from './env';
import { handleHubRequest } from './hub/routes';
import { handlePing, handlePingUrl } from './ping';
import { getEdgeLocation } from './utils/location';
import { checkMonitor, runBudget } from './checkers';
import {
  createNotifier,
  formatNotificationMessage,
  type NotificationContext,
  routes,
} from './notifications/webhook';
import type { Alert, AlertOutcome, AlertPolicy } from './hub/alerts';
import type { CheckRecord } from './hub/monitor-hub';

// Durable Object classes must be exports of the Worker's main module.
export { MonitorHub } from './hub/monitor-hub';

const log = createLogger('Worker');

async function safeCallback<T extends unknown[]>(
  callback: ((...args: T) => Promise<void>) | undefined,
  label: string,
  ...args: T
): Promise<void> {
  if (!callback) return;
  try {
    await callback(...args);
  } catch (error) {
    log.error(`${label} error`, { error: String(error) });
  }
}

/** The config's webhooks plus FLAREWATCH_WEBHOOKS, which keeps webhook URLs out of a public fork. */
function alertWebhooks(config: WorkerConfig, secret: string | undefined): Webhook[] {
  const configured = config.notification?.webhook;
  const listed =
    configured === undefined ? [] : Array.isArray(configured) ? configured : [configured];
  if (!secret) return listed;
  const ids = config.monitors.map(({ id }) => id);
  const { webhooks, issues } = parseSecretWebhooks(secret, ids);
  for (const issue of issues) log.error('Skipping part of FLAREWATCH_WEBHOOKS', { issue });
  return [...listed, ...webhooks];
}

export interface WorkerDeps {
  readonly checkMonitor: (
    target: MonitorTarget,
    ctx: CheckContext,
  ) => Promise<CheckResultWithLocation>;
  readonly createNotifier: typeof createNotifier;
  readonly getEdgeLocation: () => Promise<string>;
  readonly staticConfig: WorkerConfig;
}

const defaultWorkerDeps: WorkerDeps = {
  checkMonitor,
  createNotifier,
  getEdgeLocation,
  staticConfig: workerConfig,
};

export async function runChecks(env: Env, deps: WorkerDeps = defaultWorkerDeps): Promise<void> {
  const location = await deps.getEdgeLocation();
  log.info('Starting checks', { location });

  const config = deps.staticConfig;
  const hub = getHub(env);

  const currentTime = Math.floor(Date.now() / 1000);
  const webhooks = alertWebhooks(config, env.FLAREWATCH_WEBHOOKS);
  const notifier = deps.createNotifier(webhooks);
  const budget = runBudget(config.monitors, webhooks.length);

  const ctx: CheckContext = { env, budget };
  const records = await Promise.all(
    config.monitors.map(async (monitor): Promise<CheckRecord> => {
      if (monitor.method === 'HEARTBEAT') return { monitor };
      log.info('Checking monitor', { name: monitor.name });
      return { monitor, check: await deps.checkMonitor(monitor, ctx) };
    }),
  );

  const policy: AlertPolicy | undefined = notifier
    ? {
        gracePeriodSeconds: (config.notification?.gracePeriod ?? 0) * 60,
        // A monitor no webhook takes is never claimed, so it cannot use up its tries.
        skipIds: [
          ...(config.notification?.skipNotificationIds ?? []),
          ...config.monitors
            .filter(({ id }) => !webhooks.some((webhook) => routes(webhook, id)))
            .map(({ id }) => id),
        ],
        skipErrorChanges: Boolean(config.notification?.skipErrorChangeNotification),
      }
    : undefined;
  const { updates, alerts } = await hub.record(currentTime, records, policy);
  const monitors = new Map(config.monitors.map((monitor) => [monitor.id, monitor]));

  // runBudget held one request per webhook, so the first alert is paid for.
  let prepaid = true;
  const deliver = async (batch: Alert[]) => {
    const outcomes: AlertOutcome[] = [];
    for (const alert of batch) {
      const monitor = monitors.get(alert.monitorId);
      let delivered = false;
      if (notifier && monitor) {
        const cost = webhooks.filter((webhook) => routes(webhook, monitor.id)).length;
        if (prepaid) prepaid = false;
        else if (budget.subrequests >= cost) budget.subrequests -= cost;
        else {
          outcomes.push({
            incident: alert.incident,
            kind: alert.kind,
            reopenedAt: alert.reopenedAt,
            run: alert.run,
            delivered,
            deferred: true,
          });
          continue;
        }
        const at = alert.at ?? currentTime;
        const ctx: NotificationContext = {
          monitor,
          kind: alert.kind,
          incidentStartTime: alert.incidentStartTime,
          currentTime: at,
          downtimeSeconds: at - alert.incidentStartTime,
          reason: alert.error,
          timeZone: config.notification?.timeZone ?? 'UTC',
          alsoDown: alert.alsoDown,
          ...(alert.reminder !== undefined && { reminder: alert.reminder }),
        };
        try {
          const results = await notifier.send(ctx, formatNotificationMessage(ctx));
          delivered = results.some((result) => result.success);
        } catch (error) {
          log.error('Alert failed', { monitor: monitor.id, error: String(error) });
        }
      }
      outcomes.push({
        incident: alert.incident,
        kind: alert.kind,
        reopenedAt: alert.reopenedAt,
        run: alert.run,
        delivered,
      });
    }
    return outcomes;
  };
  // Reporting a down alert's outcome can turn up the recovery of an outage that ended meanwhile.
  for (let batch = alerts; batch.length > 0;) {
    batch = await hub.confirmAlerts(await deliver(batch));
  }

  for (const update of updates) {
    const monitor = monitors.get(update.monitorId);
    if (!monitor) continue;

    if (update.statusChanged) {
      await safeCallback(
        config.callbacks?.onStatusChange,
        'Callback',
        env,
        monitor,
        update.isUp,
        update.incidentStartTime,
        currentTime,
        update.error,
      );
    }

    if (!update.isUp) {
      await safeCallback(
        config.callbacks?.onIncident,
        'Incident callback',
        env,
        monitor,
        update.incidentStartTime,
        currentTime,
        update.error,
      );
    }
  }

  log.info('Complete', { monitors: records.length });
}

const Worker = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
    deps: WorkerDeps = defaultWorkerDeps,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Every route trusts its caller: only the status page's MONITOR_WORKER binding
    // reaches this worker (workers_dev and preview_urls off, no routes; a test
    // holds wrangler.toml to that). Routing it publicly needs an auth check first.
    if (url.pathname === '/trigger' && request.method === 'POST') {
      ctx.waitUntil(runChecks(env, deps));
      return Response.json({ success: true, message: 'Check triggered' }, { status: 202 });
    }
    if (url.pathname.startsWith(CHECK_NOW_PREFIX) && request.method === 'POST') {
      return handleCheckNow(request, env, deps);
    }

    const hubResponse = await handleHubRequest(request, env);
    if (hubResponse) return hubResponse;

    if (url.pathname.startsWith('/ping/')) {
      return handlePing(request, env, deps.staticConfig);
    }
    if (url.pathname.startsWith('/ping-url/')) {
      return handlePingUrl(request, env, deps.staticConfig);
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runChecks(env);
  },
};

export default Worker;

import {
  type CheckContext,
  createLogger,
  failure,
  type CheckResultWithLocation,
  type MonitorTarget,
  parseSecretWebhooks,
  type WebhookConfig,
  type WorkerConfig,
} from '@flarewatch/shared';
import { workerConfig } from '@flarewatch/config/worker';

import { getHub, type Env } from './env';
import { handleHubRequest } from './hub/routes';
import { handlePing, handlePingUrl } from './ping';
import { getEdgeLocation } from './utils/location';
import { checkMonitor } from './checkers';
import {
  createNotifier,
  formatNotificationMessage,
  type NotificationContext,
} from './notifications/webhook';
import type { Alert, AlertPolicy, CheckRecord } from './hub/monitor-hub';

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
function alertWebhooks(
  configured: WebhookConfig | undefined,
  secret: string | undefined,
): WebhookConfig | undefined {
  if (!secret) return configured;
  const { webhooks, issues } = parseSecretWebhooks(secret);
  for (const issue of issues) log.error('Skipping part of FLAREWATCH_WEBHOOKS', { issue });
  const listed =
    configured === undefined ? [] : Array.isArray(configured) ? configured : [configured];
  return [...listed, ...webhooks];
}

export interface WorkerDeps {
  readonly checkMonitor: (
    target: MonitorTarget,
    ctx: CheckContext,
  ) => Promise<CheckResultWithLocation>;
  readonly createNotifier: typeof createNotifier;
  readonly formatNotificationMessage: typeof formatNotificationMessage;
  readonly getEdgeLocation: () => Promise<string>;
  readonly staticConfig: WorkerConfig;
}

const defaultWorkerDeps: WorkerDeps = {
  checkMonitor,
  createNotifier,
  formatNotificationMessage,
  getEdgeLocation,
  staticConfig: workerConfig,
};

export async function runChecks(env: Env, deps: WorkerDeps = defaultWorkerDeps): Promise<void> {
  const location = await deps.getEdgeLocation();
  log.info('Starting checks', { location });

  const config = deps.staticConfig;
  const hub = getHub(env);

  const currentTime = Math.floor(Date.now() / 1000);
  const notifier = deps.createNotifier(
    alertWebhooks(config.notification?.webhook, env.FLAREWATCH_WEBHOOKS),
  );

  const records = await Promise.all(
    config.monitors.map(async (monitor): Promise<CheckRecord> => {
      if (monitor.method === 'HEARTBEAT') return { monitor };
      log.info('Checking monitor', { name: monitor.name });
      try {
        return { monitor, check: await deps.checkMonitor(monitor, { env }) };
      } catch (error) {
        log.error('Check failed', { monitor: monitor.id, error: String(error) });
        return { monitor, check: { location, result: failure(`Check failed: ${String(error)}`) } };
      }
    }),
  );

  const policy: AlertPolicy | undefined = notifier
    ? {
        gracePeriodSeconds: (config.notification?.gracePeriod ?? 0) * 60,
        skipIds: config.notification?.skipNotificationIds ?? [],
        skipErrorChanges: Boolean(config.notification?.skipErrorChangeNotification),
      }
    : undefined;
  const { updates, alerts } = await hub.record(currentTime, records, policy);
  const monitors = new Map(config.monitors.map((monitor) => [monitor.id, monitor]));

  const deliver = async (batch: Alert[]) => {
    const outcomes: { incident: number; delivered: boolean }[] = [];
    if (!notifier) return outcomes;
    for (const alert of batch) {
      const monitor = monitors.get(alert.monitorId);
      if (!monitor) continue;
      const ctx: NotificationContext = {
        monitor,
        isUp: alert.kind === 'up',
        incidentStartTime: alert.incidentStartTime,
        currentTime: alert.at ?? currentTime,
        reason: alert.error,
        timeZone: config.notification?.timeZone ?? 'UTC',
        alsoDown: alert.alsoDown,
      };
      let delivered = false;
      try {
        const results = await notifier.send(ctx, deps.formatNotificationMessage(ctx));
        delivered = results.some((result) => result.success);
      } catch (error) {
        log.error('Alert failed', { monitor: monitor.id, error: String(error) });
      }
      if (alert.kind === 'down') outcomes.push({ incident: alert.incident, delivered });
    }
    return outcomes;
  };
  const outcomes = await deliver(alerts);
  if (outcomes.length > 0) await deliver(await hub.confirmAlerts(outcomes));

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

    // Internal binding only; add a secret check if this worker is ever routed publicly.
    if (url.pathname === '/trigger' && request.method === 'POST') {
      ctx.waitUntil(runChecks(env, deps));
      return Response.json({ success: true, message: 'Check triggered' }, { status: 202 });
    }

    const hubResponse = await handleHubRequest(request, env);
    if (hubResponse) return hubResponse;

    // Ping routes and /ping-url are only reachable through the MONITOR_WORKER
    // service binding; the worker has no public ingress (workers_dev = false).
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

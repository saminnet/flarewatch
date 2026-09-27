import {
  type CheckContext,
  createLogger,
  failure,
  type CheckResultWithLocation,
  type MonitorTarget,
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
import type { CheckRecord } from './hub/monitor-hub';

// Durable Object classes must be exports of the Worker's main module.
export { MonitorHub } from './hub/monitor-hub';

const log = createLogger('Worker');

const GRACE_PERIOD_BUFFER_SECONDS = 30;

function skipsNotification(monitorId: string, config: WorkerConfig): boolean {
  return (config.notification?.skipNotificationIds ?? []).includes(monitorId);
}

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

/**
 * Determine if notification should be sent based on grace period.
 *
 * Grace period logic:
 * - No grace period configured: notify immediately on any status change
 * - With grace period: wait until grace period elapses before notifying
 * - For UP transitions: only notify if the DOWN would have been notified
 * - For DOWN: notify when grace period threshold is crossed
 */
function shouldNotify(
  incidentStartTime: number,
  currentTime: number,
  statusChanged: boolean,
  isUp: boolean,
  config: WorkerConfig,
  ignoreGracePeriod: boolean,
): boolean {
  if (ignoreGracePeriod) return statusChanged;

  const gracePeriod = config.notification?.gracePeriod;

  if (gracePeriod === undefined) {
    return statusChanged;
  }

  const gracePeriodSeconds = gracePeriod * 60;
  const timeSinceIncident = currentTime - incidentStartTime;
  const gracePeriodReached = timeSinceIncident >= gracePeriodSeconds - GRACE_PERIOD_BUFFER_SECONDS;

  if (!gracePeriodReached) {
    return false;
  }

  if (statusChanged) {
    return true;
  }

  if (!isUp) {
    const justCrossedThreshold =
      timeSinceIncident < gracePeriodSeconds + GRACE_PERIOD_BUFFER_SECONDS;
    return justCrossedThreshold;
  }

  return false;
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

/** Used by both the scheduled handler and the /trigger endpoint. */
export async function runChecks(env: Env, deps: WorkerDeps = defaultWorkerDeps): Promise<void> {
  const location = await deps.getEdgeLocation();
  log.info('Starting checks', { location });

  const config = deps.staticConfig;
  const hub = getHub(env);

  const currentTime = Math.floor(Date.now() / 1000);
  const notifier = deps.createNotifier(config.notification?.webhook);

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

  const updates = await hub.record(currentTime, records);
  const monitors = new Map(config.monitors.map((monitor) => [monitor.id, monitor]));

  for (const update of updates) {
    const monitor = monitors.get(update.monitorId);
    if (!monitor) continue;

    if (notifier && !update.inMaintenance && !skipsNotification(monitor.id, config)) {
      const skipErrorChanges = Boolean(config.notification?.skipErrorChangeNotification);
      const statusChangedForNotification =
        update.changeType === 'up' ||
        update.changeType === 'down' ||
        (update.changeType === 'error' && !skipErrorChanges);

      const shouldSend = shouldNotify(
        update.incidentStartTime,
        currentTime,
        statusChangedForNotification,
        update.isUp,
        config,
        monitor.method === 'HEARTBEAT',
      );

      if (shouldSend) {
        const ctx: NotificationContext = {
          monitor,
          isUp: update.isUp,
          incidentStartTime: update.incidentStartTime,
          currentTime,
          reason: update.error,
          timeZone: config.notification?.timeZone ?? 'UTC',
        };
        const message = deps.formatNotificationMessage(ctx);
        await notifier.send(ctx, message);
      }
    }

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

    // Trigger check (internal binding only). If you route this worker publicly,
    // add a secret check here.
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

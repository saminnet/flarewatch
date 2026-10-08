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

function checkDue(monitor: MonitorTarget, minute: number): boolean {
  let hash = 0;
  for (const char of monitor.id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  const interval = monitor.checkEveryMinutes ?? (monitor.method === 'DOMAIN' ? 1440 : 1);
  return minute % interval === hash % interval;
}

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

export async function runChecks(
  env: Env,
  deps: WorkerDeps = defaultWorkerDeps,
  scheduledAt?: number,
  spentSubrequests = 0,
): Promise<void> {
  const startedAt = Date.now();
  const location = await deps.getEdgeLocation();
  log.info('Starting checks', { location });

  const config = deps.staticConfig;
  const hub = getHub(env);

  const currentTime = Math.floor(startedAt / 1000);
  const webhooks = alertWebhooks(config, env.FLAREWATCH_WEBHOOKS);
  const notifier = deps.createNotifier(webhooks);
  const due = config.monitors.filter(
    (monitor) =>
      monitor.method !== 'HEARTBEAT' &&
      checkDue(monitor, Math.floor((scheduledAt ?? startedAt) / 60000)),
  );
  const dueIds = new Set(due.map((monitor) => monitor.id));
  const budget = runBudget(due, webhooks.length, startedAt);
  budget.subrequests = Math.max(0, budget.subrequests - spentSubrequests);

  const ctx: CheckContext = { env, budget };
  const records = await Promise.all(
    config.monitors.map(async (monitor): Promise<CheckRecord> => {
      if (monitor.method === 'HEARTBEAT') return { monitor };
      if (!dueIds.has(monitor.id)) return { monitor };
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

  // The run held back one request per webhook. Each webhook spends it last, so the alerts that
  // the spare budget cannot send one by one still go out, together as one summary.
  let reserved = webhooks.length;
  const spend = (fromReserve: boolean): boolean => {
    if (fromReserve && reserved > 0) {
      reserved--;
      return true;
    }
    if (budget.subrequests < 1) return false;
    budget.subrequests--;
    return true;
  };
  const context = (alert: Alert): NotificationContext | undefined => {
    const monitor = monitors.get(alert.monitorId);
    if (!monitor) return undefined;
    const at = alert.at ?? currentTime;
    return {
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
  };
  const deliver = async (batch: Alert[]) => {
    const summaryAfter = config.notification?.summaryAfter ?? Infinity;
    const entries = batch.flatMap((alert) => {
      const ctx = context(alert);
      return !ctx && summaryAfter !== Infinity && notifier
        ? []
        : [{ alert, ctx, delivered: false, attempted: !notifier || !ctx }];
    });
    if (notifier) {
      type Entry = (typeof entries)[number];
      const send = async (webhook: Webhook, group: Entry[]) => {
        for (const entry of group) entry.attempted = true;
        try {
          const results =
            group.length > 1
              ? [
                  await notifier.sendSummary(
                    webhook,
                    group.map(({ ctx }) => ctx!),
                  ),
                ]
              : await notifier.send(
                  group[0]!.ctx!,
                  formatNotificationMessage(group[0]!.ctx!),
                  webhook,
                );
          if (results.some((result) => result.success))
            for (const entry of group) entry.delivered = true;
        } catch (error) {
          log.error('Alert failed', { error: String(error) });
        }
      };
      for (const webhook of webhooks) {
        const routed = entries.filter(({ alert, ctx }) => ctx && routes(webhook, alert.monitorId));
        if (routed.length === 0) continue;
        let next = 0;
        if (routed.length < summaryAfter) {
          for (; next < routed.length - 1 && spend(false); next++)
            await send(webhook, [routed[next]!]);
        }
        if (spend(true)) await send(webhook, routed.slice(next));
      }
    }
    return entries.map(({ alert, delivered, attempted }): AlertOutcome => ({
      ...alert,
      delivered,
      ...(!attempted && { deferred: true }),
    }));
  };
  if (alerts.length > 0) {
    // Reporting a down alert's outcome can turn up the recovery of an outage that ended meanwhile.
    // The hub keeps nothing about a recovery, so its outcome is not reported.
    const recoveries = await hub.confirmAlerts(await deliver(alerts));
    if (recoveries.length > 0) await deliver(recoveries);
  }

  for (const update of updates) {
    const monitor = monitors.get(update.monitorId);
    if (!monitor) continue;

    if (update.changeType === 'up' || update.changeType === 'down') {
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
      const admitted = await getHub(env).claimInitialCheck(Date.now());
      if (admitted) ctx.waitUntil(runChecks(env, deps, undefined, 1));
      return Response.json(
        {
          success: true,
          message: admitted ? 'Check triggered' : 'Already initialized or initializing',
        },
        { status: 202 },
      );
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

  async scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runChecks(env, defaultWorkerDeps, event.scheduledTime);
  },
};

export default Worker;

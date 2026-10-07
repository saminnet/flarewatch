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

  let prepaid = webhooks.length;
  const affordAlert = (cost: number): boolean => {
    const extra = Math.max(0, cost - prepaid);
    if (budget.subrequests < extra) return false;
    prepaid = Math.max(0, prepaid - cost);
    budget.subrequests -= extra;
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
      const recipients: (Webhook | undefined)[] =
        summaryAfter === Infinity ? [undefined] : webhooks;
      for (const webhook of recipients) {
        const routed = webhook
          ? entries.filter(({ alert }) => routes(webhook, alert.monitorId))
          : entries;
        const groups = routed.length >= summaryAfter ? [routed] : routed.map((entry) => [entry]);
        for (const group of groups) {
          const ctx = group[0]!.ctx;
          if (!ctx) continue;
          const cost = webhook ? 1 : webhooks.filter((hook) => routes(hook, ctx.monitor.id)).length;
          if (!affordAlert(cost)) continue;
          for (const entry of group) entry.attempted = true;
          try {
            const results =
              webhook && group.length >= summaryAfter
                ? [
                    await notifier.sendSummary(
                      webhook,
                      group.map(({ ctx }) => ctx!),
                    ),
                  ]
                : await notifier.send(ctx, formatNotificationMessage(ctx), webhook);
            if (results.some((result) => result.success))
              for (const entry of group) entry.delivered = true;
          } catch (error) {
            log.error('Alert failed', {
              ...(!webhook && { monitor: ctx.monitor.id }),
              error: String(error),
            });
          }
        }
      }
    }
    return entries.map(({ alert, delivered, attempted }): AlertOutcome => ({
      ...alert,
      delivered,
      ...(!attempted && { deferred: true }),
    }));
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

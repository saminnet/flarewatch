import {
  createLogger,
  isMonitorState,
  KV_KEYS,
  loadRuntimeConfig,
  type Maintenance,
  readMaintenancesFromStorage,
  type RuntimeConfig,
  type WorkerConfig,
} from '@flarewatch/shared';
import { workerConfig } from '@flarewatch/config/worker';

import { getEdgeLocation } from './utils/location';
import { checkMonitor } from './checkers';
import {
  createNotifier,
  formatNotificationMessage,
  type NotificationContext,
} from './notifications/webhook';
import {
  createInitialState,
  resetCounters,
  processCheckResult,
  updateLatency,
  updateSSLCertificate,
  cleanupOldIncidents,
} from './state/incidents';

const log = createLogger('Worker');

interface Env {
  CONFIG_KV?: KVNamespace;
  STATE_KV?: KVNamespace;
  FLAREWATCH_STATE?: KVNamespace;
  /** Sent as `Authorization: Bearer <token>` on every external proxy check. */
  FLAREWATCH_PROXY_TOKEN?: string;
}

const DEFAULT_COOLDOWN_MINUTES = 3;

const GRACE_PERIOD_BUFFER_SECONDS = 30;

function getStateKv(env: Env): KVNamespace {
  const kv = env.STATE_KV ?? env.FLAREWATCH_STATE;
  if (!kv) {
    throw new Error('STATE_KV (or FLAREWATCH_STATE) binding not found');
  }
  return kv;
}

async function loadEffectiveConfig(env: Env, staticConfig: WorkerConfig): Promise<RuntimeConfig> {
  if (env.CONFIG_KV) {
    const runtimeConfig = await loadRuntimeConfig(env.CONFIG_KV);
    if (runtimeConfig) {
      return runtimeConfig;
    }
    log.error('Invalid runtime config in CONFIG_KV, falling back to static config');
  }

  const config: RuntimeConfig = { monitors: staticConfig.monitors };
  if (staticConfig.notification) {
    config.notification = staticConfig.notification;
  }
  if (staticConfig.kvWriteCooldownMinutes !== undefined) {
    config.kvWriteCooldownMinutes = staticConfig.kvWriteCooldownMinutes;
  }
  return config;
}

function isInMaintenance(
  monitorId: string,
  currentTime: number,
  maintenances: Maintenance[],
): boolean {
  return maintenances.some((m) => {
    const startTime = new Date(m.start).getTime() / 1000;
    const endTime = m.end ? new Date(m.end).getTime() / 1000 : Infinity;
    if (currentTime < startTime || currentTime > endTime) return false;
    return !m.monitors?.length || m.monitors.includes(monitorId);
  });
}

function shouldSkipNotification(
  monitorId: string,
  currentTime: number,
  maintenances: Maintenance[],
  config: RuntimeConfig,
): boolean {
  const skipList = config.notification?.skipNotificationIds ?? [];
  return skipList.includes(monitorId) || isInMaintenance(monitorId, currentTime, maintenances);
}

async function loadMaintenances(kv: KVNamespace): Promise<Maintenance[]> {
  try {
    return readMaintenancesFromStorage(kv);
  } catch (error) {
    log.error('Failed to load maintenances from KV', { error: String(error) });
    return [];
  }
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
  config: RuntimeConfig,
): boolean {
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
  readonly checkMonitor: typeof checkMonitor;
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

  const config = await loadEffectiveConfig(env, deps.staticConfig);

  const stateKv = getStateKv(env);
  const storedState = await stateKv.get(KV_KEYS.STATE, {
    type: 'json',
  });
  const state = isMonitorState(storedState) ? storedState : createInitialState();
  resetCounters(state);

  const maintenances = await loadMaintenances(stateKv);

  const currentTime = Math.floor(Date.now() / 1000);
  const notifier = deps.createNotifier(config.notification?.webhook);

  const checkResults = await Promise.allSettled(
    config.monitors.map(async (monitor) => {
      log.info('Checking monitor', { name: monitor.name });
      const result = await deps.checkMonitor(monitor, env);

      return { monitor, result };
    }),
  );

  let stateChanged = false;

  for (const settled of checkResults) {
    if (settled.status === 'rejected') {
      log.error('Check failed', { reason: String(settled.reason) });
      state.overallDown++;
      continue;
    }

    const { monitor, result } = settled.value;
    const { location: checkLocation, result: checkResult } = result;

    const update = processCheckResult(state, monitor, checkResult, currentTime);
    stateChanged ||= update.statusChanged;

    const latency = checkResult.latency ?? 0;
    updateLatency(state, monitor.id, checkLocation, latency, currentTime);

    if (checkResult.ok && checkResult.ssl) {
      updateSSLCertificate(state, monitor.id, checkResult.ssl, currentTime);
    }

    cleanupOldIncidents(state, monitor.id, currentTime);

    if (notifier && !shouldSkipNotification(monitor.id, currentTime, maintenances, config)) {
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
        deps.staticConfig.callbacks?.onStatusChange,
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
        deps.staticConfig.callbacks?.onIncident,
        'Incident callback',
        env,
        monitor,
        update.incidentStartTime,
        currentTime,
        update.error,
      );
    }
  }

  const cooldownSeconds = (config.kvWriteCooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES) * 60;
  const timeSinceUpdate = currentTime - state.lastUpdate;

  if (stateChanged || timeSinceUpdate >= cooldownSeconds - 10) {
    log.info('Saving state', { changed: stateChanged });
    state.lastUpdate = currentTime;
    await stateKv.put(KV_KEYS.STATE, JSON.stringify(state));
  } else {
    log.debug('Skipping state save', { cooldownRemaining: cooldownSeconds - timeSinceUpdate });
  }

  log.info('Complete', { up: state.overallUp, down: state.overallDown });
}

const Worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Trigger check (internal binding only). If you route this worker publicly,
    // add a secret check here.
    if (url.pathname === '/trigger' && request.method === 'POST') {
      ctx.waitUntil(runChecks(env));
      return Response.json({ success: true, message: 'Check triggered' }, { status: 202 });
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runChecks(env);
  },
};

export default Worker;

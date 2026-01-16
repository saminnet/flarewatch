import type { MonitorState, Maintenance, RuntimeConfig } from '@flarewatch/shared';
import { createLogger, KV_KEYS, loadRuntimeConfig } from '@flarewatch/shared';
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
import { isMonitorState, parseMaintenances } from './state/validate';

const log = createLogger('Worker');

export interface Env {
  CONFIG_KV?: KVNamespace;
  STATE_KV?: KVNamespace;
  FLAREWATCH_STATE?: KVNamespace;
  /**
   * Optional Bearer token used when calling external check proxies.
   * If set, the worker sends `Authorization: Bearer <token>` with every proxied check request.
   */
  FLAREWATCH_PROXY_TOKEN?: string;
}

/** Default KV write cooldown in minutes */
const DEFAULT_COOLDOWN_MINUTES = 3;

/** Buffer (in seconds) around grace period threshold for notification timing */
const GRACE_PERIOD_BUFFER_SECONDS = 30;

function getStateKv(env: Env): KVNamespace {
  const kv = env.STATE_KV ?? env.FLAREWATCH_STATE;
  if (!kv) {
    throw new Error('STATE_KV (or FLAREWATCH_STATE) binding not found');
  }
  return kv;
}

async function loadEffectiveConfig(env: Env): Promise<RuntimeConfig> {
  if (env.CONFIG_KV) {
    const runtimeConfig = await loadRuntimeConfig(env.CONFIG_KV);
    if (runtimeConfig) {
      return runtimeConfig;
    }
    log.error('Invalid runtime config in CONFIG_KV, falling back to static config');
  }

  const config: RuntimeConfig = { monitors: workerConfig.monitors };
  if (workerConfig.notification) {
    config.notification = workerConfig.notification;
  }
  if (workerConfig.kvWriteCooldownMinutes !== undefined) {
    config.kvWriteCooldownMinutes = workerConfig.kvWriteCooldownMinutes;
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
    const data = await kv.get(KV_KEYS.MAINTENANCES, { type: 'json' });
    if (!data) return [];
    const maintenances = parseMaintenances(data);
    if (maintenances.length === 0 && Array.isArray(data) && data.length > 0) {
      log.error('Invalid maintenance data format in KV');
    }
    return maintenances;
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

  // No grace period configured - notify on any status change
  if (gracePeriod === undefined) {
    return statusChanged;
  }

  const gracePeriodSeconds = gracePeriod * 60;
  const timeSinceIncident = currentTime - incidentStartTime;
  const gracePeriodReached = timeSinceIncident >= gracePeriodSeconds - GRACE_PERIOD_BUFFER_SECONDS;

  // Must have reached grace period to send any notification
  if (!gracePeriodReached) {
    return false;
  }

  // Status changed (up or down) - notify if grace period reached
  if (statusChanged) {
    return true;
  }

  // No status change but grace period just crossed - send delayed DOWN notification
  if (!isUp) {
    const justCrossedThreshold =
      timeSinceIncident < gracePeriodSeconds + GRACE_PERIOD_BUFFER_SECONDS;
    return justCrossedThreshold;
  }

  return false;
}

/**
 * Core check logic - runs all monitors and updates state.
 * Used by both scheduled handler and /trigger endpoint.
 */
async function runChecks(env: Env): Promise<void> {
  const location = await getEdgeLocation();
  log.info('Starting checks', { location });

  const config = await loadEffectiveConfig(env);

  const stateKv = getStateKv(env);
  const storedState = await stateKv.get(KV_KEYS.STATE, {
    type: 'json',
  });
  const state: MonitorState = isMonitorState(storedState) ? storedState : createInitialState();
  resetCounters(state);

  const maintenances = await loadMaintenances(stateKv);

  const currentTime = Math.floor(Date.now() / 1000);
  const notifier = createNotifier(config.notification?.webhook);

  const checkResults = await Promise.allSettled(
    config.monitors.map(async (monitor) => {
      log.info('Checking monitor', { name: monitor.name });
      const result = await checkMonitor(monitor, env);

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

    const latency = checkResult.ok ? checkResult.latency : (checkResult.latency ?? 0);
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
        const message = formatNotificationMessage(ctx);
        await notifier.send(ctx, message);
      }
    }

    if (update.statusChanged) {
      await safeCallback(
        workerConfig.callbacks?.onStatusChange,
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
        workerConfig.callbacks?.onIncident,
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
      // Run checks in background, return immediately
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

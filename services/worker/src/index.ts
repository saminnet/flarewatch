import {
  type CheckContext,
  createLogger,
  HEARTBEAT_RUN_HISTORY,
  type HeartbeatState,
  isMonitorState,
  isPublicMonitor,
  KV_KEYS,
  type Maintenance,
  type Monitor,
  type MonitorCheckResult,
  readMaintenancesFromStorage,
  type RuntimeConfig,
  type WorkerConfig,
} from '@flarewatch/shared';
import { workerConfig } from '@flarewatch/config/worker';

import { getStateKv, loadEffectiveConfig, type Env } from './env';
import { handlePing, handlePingUrl } from './ping';
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

const DEFAULT_COOLDOWN_MINUTES = 3;

const GRACE_PERIOD_BUFFER_SECONDS = 30;

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

function heartbeatStateChanged(
  previous: HeartbeatState | undefined,
  next: HeartbeatState,
): boolean {
  return (
    previous?.status !== next.status ||
    previous.lastSuccess !== next.lastSuccess ||
    previous.lastFail !== next.lastFail ||
    previous.lastStart !== next.lastStart ||
    previous.message !== next.message ||
    previous.deadline !== next.deadline ||
    previous.misses?.[previous.misses.length - 1] !== next.misses?.[next.misses.length - 1]
  );
}

export interface WorkerDeps {
  readonly checkMonitor: (target: Monitor, ctx: CheckContext) => Promise<MonitorCheckResult>;
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
  state.heartbeat ??= {};
  resetCounters(state);

  const maintenances = await loadMaintenances(stateKv);

  const currentTime = Math.floor(Date.now() / 1000);
  const notifier = deps.createNotifier(config.notification?.webhook);

  const checkResults = await Promise.allSettled(
    config.monitors.map((monitor) => {
      log.info('Checking monitor', { name: monitor.name });
      return deps.checkMonitor(monitor, { env, now: currentTime, stateKv });
    }),
  );

  let stateChanged = false;

  for (const [index, settled] of checkResults.entries()) {
    const monitor = config.monitors[index]!;
    if (settled.status === 'rejected') {
      log.error('Check failed', { monitor: monitor.id, error: String(settled.reason) });
      if (isPublicMonitor(monitor)) state.overallDown++;
      continue;
    }

    const { location: checkLocation, result: checkResult, heartbeat } = settled.value;

    if (heartbeat) {
      const previous = state.heartbeat[monitor.id];

      // Deadline misses live in the state blob, never in the ping signal: the
      // checker must not read-modify-write hb:v1:<id>, where a concurrent ping
      // would be erased. While a job stays overdue, one miss is appended per
      // elapsed period so a long outage shows every skipped run.
      const previousMisses = previous?.misses;
      if (previousMisses?.length) heartbeat.misses = previousMisses;
      if (
        monitor.method === 'HEARTBEAT' &&
        heartbeat.status === 'down' &&
        heartbeat.lastFail === undefined &&
        heartbeat.deadline !== undefined
      ) {
        const period = monitor.periodSeconds;
        const lastMiss = previousMisses?.[previousMisses.length - 1];
        const firstMiss = Math.max(
          heartbeat.deadline,
          lastMiss === undefined ? -Infinity : lastMiss + period,
        );
        const count = Math.floor((currentTime - firstMiss) / period) + 1;
        if (count > 0) {
          const skipped = Math.max(0, count - HEARTBEAT_RUN_HISTORY);
          const appended = Array.from(
            { length: count - skipped },
            (_, i) => firstMiss + (skipped + i) * period,
          );
          heartbeat.misses = [...(previousMisses ?? []), ...appended].slice(-HEARTBEAT_RUN_HISTORY);
        }
      }

      stateChanged ||= heartbeatStateChanged(previous, heartbeat);
      state.heartbeat[monitor.id] = heartbeat;
      if (heartbeat.status === 'late' && isPublicMonitor(monitor)) {
        state.overallLate = (state.overallLate ?? 0) + 1;
      }

      // Pending and running produce no check result, so count them here: up,
      // unless a restart happens inside an overdue incident that is still open.
      if (
        isPublicMonitor(monitor) &&
        (heartbeat.status === 'pending' || heartbeat.status === 'running')
      ) {
        const incidents = state.incident[monitor.id];
        const last = incidents?.[incidents.length - 1];
        if (last && last.end === undefined) state.overallDown++;
        else state.overallUp++;
      }
    }

    if (!checkResult) continue;

    const update = processCheckResult(state, monitor, checkResult, currentTime);
    stateChanged ||= update.statusChanged;

    if (monitor.method !== 'HEARTBEAT') {
      updateLatency(state, monitor.id, checkLocation, checkResult.latency ?? 0, currentTime);
      if (checkResult.ok && checkResult.ssl) {
        updateSSLCertificate(state, monitor.id, checkResult.ssl, currentTime);
      }
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

  log.info('Complete', {
    up: state.overallUp,
    down: state.overallDown,
    late: state.overallLate ?? 0,
  });
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

    // Ping routes and /ping-url are only reachable through the MONITOR_WORKER
    // service binding; the worker has no public ingress (workers_dev = false).
    if (url.pathname.startsWith('/ping/')) {
      return handlePing(request, env, () => loadEffectiveConfig(env, deps.staticConfig));
    }
    if (url.pathname.startsWith('/ping-url/')) {
      return handlePingUrl(request, env, await loadEffectiveConfig(env, deps.staticConfig));
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runChecks(env);
  },
};

export default Worker;

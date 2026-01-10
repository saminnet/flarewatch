import type { MonitorState, Maintenance } from '@flarewatch/shared';
import { createLogger } from '@flarewatch/shared';
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
  FLAREWATCH_STATE: KVNamespace;
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

function isInMaintenance(
  monitorId: string,
  currentTime: number,
  maintenances: Maintenance[],
): boolean {
  return maintenances.some((m) => {
    const startTime = new Date(m.start).getTime() / 1000;
    const endTime = m.end ? new Date(m.end).getTime() / 1000 : Infinity;
    const affectsMonitor = !m.monitors?.length || m.monitors.includes(monitorId);
    return currentTime >= startTime && currentTime <= endTime && affectsMonitor;
  });
}

function shouldSkipNotification(
  monitorId: string,
  currentTime: number,
  maintenances: Maintenance[],
): boolean {
  const skipList = workerConfig.notification?.skipNotificationIds ?? [];
  return skipList.includes(monitorId) || isInMaintenance(monitorId, currentTime, maintenances);
}

async function loadMaintenances(kv: KVNamespace): Promise<Maintenance[]> {
  try {
    const data = await kv.get('maintenances', { type: 'json' });
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
 * Determine if notification should be sent based on grace period
 */
function shouldNotify(
  incidentStartTime: number,
  currentTime: number,
  statusChanged: boolean,
  isUp: boolean,
): boolean {
  const gracePeriod = workerConfig.notification?.gracePeriod;

  // No grace period - always notify on change
  if (gracePeriod === undefined) {
    return statusChanged;
  }

  const gracePeriodSeconds = gracePeriod * 60;
  const timeSinceIncident = currentTime - incidentStartTime;

  const gracePeriodReached = timeSinceIncident >= gracePeriodSeconds - GRACE_PERIOD_BUFFER_SECONDS;

  if (isUp) {
    // Only notify UP if we would have notified DOWN
    return statusChanged && gracePeriodReached;
  }

  // For DOWN: notify when grace period is reached or on subsequent changes
  if (statusChanged) {
    return gracePeriodReached;
  }

  // Check if we just crossed the grace period threshold
  const justCrossedThreshold = timeSinceIncident < gracePeriodSeconds + GRACE_PERIOD_BUFFER_SECONDS;
  return gracePeriodReached && justCrossedThreshold;
}

const Worker = {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const location = await getEdgeLocation();
    log.info('Starting scheduled check', { location });

    const storedState = await env.FLAREWATCH_STATE.get('state', {
      type: 'json',
    });
    const state: MonitorState = isMonitorState(storedState) ? storedState : createInitialState();
    resetCounters(state);

    const maintenances = await loadMaintenances(env.FLAREWATCH_STATE);

    const currentTime = Math.floor(Date.now() / 1000);
    const notifier = createNotifier(workerConfig.notification?.webhook);

    const checkResults = await Promise.allSettled(
      workerConfig.monitors.map(async (monitor) => {
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

      if (notifier && !shouldSkipNotification(monitor.id, currentTime, maintenances)) {
        const skipErrorChanges = Boolean(workerConfig.notification?.skipErrorChangeNotification);
        const statusChangedForNotification =
          update.changeType === 'up' ||
          update.changeType === 'down' ||
          (update.changeType === 'error' && !skipErrorChanges);

        const shouldSend = shouldNotify(
          update.incidentStartTime,
          currentTime,
          statusChangedForNotification,
          update.isUp,
        );

        if (shouldSend) {
          const ctx: NotificationContext = {
            monitor,
            isUp: update.isUp,
            incidentStartTime: update.incidentStartTime,
            currentTime,
            reason: update.error,
            timeZone: workerConfig.notification?.timeZone ?? 'UTC',
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

    const cooldownSeconds = (workerConfig.kvWriteCooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES) * 60;
    const timeSinceUpdate = currentTime - state.lastUpdate;

    if (stateChanged || timeSinceUpdate >= cooldownSeconds - 10) {
      log.info('Saving state', { changed: stateChanged });
      state.lastUpdate = currentTime;
      await env.FLAREWATCH_STATE.put('state', JSON.stringify(state));
    } else {
      log.debug('Skipping state save', { cooldownRemaining: cooldownSeconds - timeSinceUpdate });
    }

    log.info('Complete', { up: state.overallUp, down: state.overallDown });
  },
};

export default Worker;

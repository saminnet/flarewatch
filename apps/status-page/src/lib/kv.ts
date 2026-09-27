import { createServerFn } from '@tanstack/react-start';
import {
  isMonitorState,
  KV_KEYS,
  type Maintenance,
  type MonitorState,
  readMaintenancesFromStorage,
} from '@flarewatch/shared';
import { INITIAL_TRIGGER_RETRY_MS } from '@/lib/constants';
import { getConfig, isPrivateOnly } from '@/lib/config';
import { requireOperator } from '@/lib/operator.server';
import { resolveMonitorState } from '@/lib/monitor-state';
import { operatorSnapshot, visitorSnapshot, type Snapshot } from '@/lib/public-view';
import { requireStateKv, resolveRuntimeEnv } from '@/lib/runtime-env';

let initialTriggerPromise: Promise<boolean> | null = null;
let lastTriggerAttempt = 0;

async function performTrigger(): Promise<boolean> {
  const env = await resolveRuntimeEnv();
  const monitorWorker = env.MONITOR_WORKER;
  if (!monitorWorker || typeof monitorWorker.fetch !== 'function') return false;

  try {
    const response = await monitorWorker.fetch('https://internal/trigger', { method: 'POST' });
    if (!response.ok) {
      console.warn('Failed to trigger initial check', { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    console.warn('Failed to trigger initial check', { error: String(error) });
    return false;
  }
}

async function triggerInitialCheck(): Promise<boolean> {
  const now = Date.now();
  if (initialTriggerPromise && now - lastTriggerAttempt < INITIAL_TRIGGER_RETRY_MS) {
    return initialTriggerPromise;
  }

  lastTriggerAttempt = now;
  initialTriggerPromise = performTrigger();
  return initialTriggerPromise;
}

async function readMonitorState(): Promise<MonitorState | null> {
  const kv = await requireStateKv();
  const state: unknown = await kv.get(KV_KEYS.STATE, { type: 'json' });
  return resolveMonitorState(isMonitorState(state) ? state : null, triggerInitialCheck);
}

async function readMaintenances(): Promise<Maintenance[]> {
  return readMaintenancesFromStorage(await requireStateKv());
}

function logAndFallback<T>(promise: Promise<T>, message: string, fallback: T): Promise<T> {
  return promise.catch((error: unknown) => {
    console.error(message, error);
    return fallback;
  });
}

/** The visitor snapshot. KV failures degrade to empty data instead of an error page. */
export async function readVisitorSnapshot(): Promise<Snapshot> {
  const [state, maintenances] = await Promise.all([
    logAndFallback(readMonitorState(), 'Error fetching monitor state:', null),
    logAndFallback(readMaintenances(), 'Error fetching maintenances:', []),
  ]);
  return visitorSnapshot(getConfig(), state, maintenances);
}

/** A private-only page serves the visitor snapshot only to the operator's Visitor view. */
export const getVisitorSnapshot = createServerFn({ method: 'GET' }).handler(async () => {
  if (isPrivateOnly(getConfig(), await resolveRuntimeEnv())) await requireOperator();
  return readVisitorSnapshot();
});

/** Includes private monitors, their raw failure messages, and every maintenance window. */
export const getOperatorSnapshot = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Snapshot> => {
    await requireOperator();
    const [state, maintenances] = await Promise.all([readMonitorState(), readMaintenances()]);
    return operatorSnapshot(getConfig(), state, maintenances);
  },
);

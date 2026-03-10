import { createServerFn } from '@tanstack/react-start';
import type { Maintenance, MonitorState } from '@flarewatch/shared';
import { KV_KEYS, readMaintenancesFromStorage } from '@flarewatch/shared';
import { INITIAL_TRIGGER_RETRY_MS } from '@/lib/constants';
import { resolveMonitorState } from '@/lib/monitor-state';
import { requireStateKv, resolveRuntimeEnv } from '@/lib/runtime-env';

let initialTriggerPromise: Promise<boolean> | null = null;
let lastTriggerAttempt = 0;

async function performTrigger(): Promise<boolean> {
  const env = await resolveRuntimeEnv();
  const monitorWorker = env?.MONITOR_WORKER;
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

/**
 * Get the monitor state from Cloudflare KV
 */
export const getMonitorState = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MonitorState | null> => {
    try {
      const kv = await requireStateKv();
      const state = await kv.get(KV_KEYS.STATE, { type: 'json' });
      return resolveMonitorState((state as MonitorState | null) ?? null, triggerInitialCheck);
    } catch (error) {
      console.error('Error fetching monitor state:', error);
      return null;
    }
  },
);

/**
 * Get all maintenances from Cloudflare KV
 */
export const getMaintenances = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Maintenance[]> => {
    try {
      const kv = await requireStateKv();
      return readMaintenancesFromStorage(kv);
    } catch (error) {
      console.error('Error fetching maintenances:', error);
      return [];
    }
  },
);

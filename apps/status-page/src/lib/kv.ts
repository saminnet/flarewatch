import { createServerFn } from '@tanstack/react-start';
import type { Maintenance, MonitorState } from '@flarewatch/shared';
import { KV_KEYS } from '@flarewatch/shared';
import { INITIAL_TRIGGER_RETRY_MS } from '@/lib/constants';
import { requireStateKv, resolveRuntimeEnv } from '@/lib/runtime-env';

let initialTriggerPromise: Promise<void> | null = null;
let lastTriggerAttempt = 0;

async function performTrigger(): Promise<void> {
  const env = await resolveRuntimeEnv();
  const monitorWorker = env?.MONITOR_WORKER;
  if (!monitorWorker || typeof monitorWorker.fetch !== 'function') return;

  try {
    const response = await monitorWorker.fetch('https://internal/trigger', { method: 'POST' });
    if (!response.ok) {
      console.warn('Failed to trigger initial check', { status: response.status });
    }
  } catch (error) {
    console.warn('Failed to trigger initial check', { error: String(error) });
  }
}

async function triggerInitialCheck(): Promise<void> {
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

      if (!state) {
        console.warn('No state found in KV');
        return null;
      }

      const monitorState = state as MonitorState;
      if (monitorState.lastUpdate === 0) {
        await triggerInitialCheck();
      }

      return monitorState;
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
      const maintenances = await kv.get(KV_KEYS.MAINTENANCES, { type: 'json' });
      return (maintenances as Maintenance[] | null) ?? [];
    } catch (error) {
      console.error('Error fetching maintenances:', error);
      return [];
    }
  },
);

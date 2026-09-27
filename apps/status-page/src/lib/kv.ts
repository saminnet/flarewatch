import { createServerFn } from '@tanstack/react-start';
import type { HubView, LatencySample } from '@flarewatch/shared';
import { INITIAL_TRIGGER_RETRY_MS } from '@/lib/constants';
import { getConfig, isPrivateOnly } from '@/lib/config';
import { fetchHubView, fetchLatency } from '@/lib/hub';
import { requireOperator } from '@/lib/operator.server';
import { latencyAccess, operatorSnapshot, visitorSnapshot, type Snapshot } from '@/lib/public-view';
import { resolveRuntimeEnv } from '@/lib/runtime-env';

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

const VIEW_CACHE_MS = 20_000;
let cachedView: { atMs: number; view: Promise<HubView> } | null = null;

/** After a maintenance edit, so this isolate's visitors see it at once. */
export function forgetCachedView(): void {
  cachedView = null;
}

/**
 * Visitors get a view reused for 20 s per isolate, so a busy page does not
 * call the hub on every render. The operator always gets a fresh one, so a
 * maintenance edit shows at once.
 */
async function readHubView(fresh: boolean): Promise<HubView> {
  const nowMs = Date.now();
  if (fresh || !cachedView || nowMs - cachedView.atMs > VIEW_CACHE_MS) {
    const view = fetchHubView();
    cachedView = { atMs: nowMs, view };
    void view.catch(() => {
      if (cachedView?.view === view) cachedView = null;
    });
  }
  const view = await cachedView.view;
  // A fresh deployment has no check run yet; start one instead of waiting for the cron.
  if (view.lastUpdate === 0) await triggerInitialCheck();
  return view;
}

function logAndFallback<T>(promise: Promise<T>, message: string, fallback: T): Promise<T> {
  return promise.catch((error: unknown) => {
    console.error(message, error);
    return fallback;
  });
}

/** The visitor snapshot. A hub failure degrades to empty data instead of an error page. */
export async function readVisitorSnapshot(): Promise<Snapshot> {
  const view = await logAndFallback(readHubView(false), 'Error fetching monitor state:', null);
  return visitorSnapshot(getConfig(), view, view?.maintenances ?? []);
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
    const view = await readHubView(true);
    return operatorSnapshot(getConfig(), view, view.maintenances);
  },
);

/** One monitor's latency, with the same audience rules as the snapshot it belongs to. */
export const getMonitorLatency = createServerFn({ method: 'GET' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<LatencySample[]> => {
    const config = getConfig();
    const access = latencyAccess(config, data.id, isPrivateOnly(config, await resolveRuntimeEnv()));
    if (access === 'none') return [];
    if (access === 'operator') await requireOperator();
    return logAndFallback(fetchLatency(data.id), 'Error fetching latency:', []);
  });

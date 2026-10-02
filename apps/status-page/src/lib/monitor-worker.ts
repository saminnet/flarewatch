import {
  isCheckResultWithLocation,
  isHubView,
  isJsonObject,
  isLatencySamples,
  isValidMaintenance,
  type CheckResultWithLocation,
  type HubView,
  type LatencySample,
  type Maintenance,
} from '@flarewatch/shared';
import { resolveRuntimeEnv } from './runtime-env';

// The status page's only client for the monitor Worker: every MONITOR_WORKER call goes through here.

const PING_RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} satisfies Record<string, string>;

type MonitorWorker = NonNullable<Cloudflare.Env['MONITOR_WORKER']>;

/** Null when this deployment has no binding; each caller picks its own fallback. */
async function monitorWorker(): Promise<MonitorWorker | null> {
  const { MONITOR_WORKER: worker } = await resolveRuntimeEnv();
  return worker && typeof worker.fetch === 'function' ? worker : null;
}

async function callMonitorWorker(path: string, init?: RequestInit): Promise<Response> {
  const worker = await monitorWorker();
  if (!worker) throw new Error('MONITOR_WORKER binding not found');
  return worker.fetch(`https://internal${path}`, init);
}

async function fromMonitorWorker(path: string): Promise<unknown> {
  const response = await callMonitorWorker(path);
  if (!response.ok) throw new Error(`Monitor worker ${path} answered ${response.status}`);
  return response.json();
}

export async function fetchHubView(): Promise<HubView> {
  const view = await fromMonitorWorker('/view');
  if (!isHubView(view)) throw new Error('Monitor worker sent an invalid view');
  return view;
}

/** Oldest start first. */
export async function fetchMaintenances(): Promise<Maintenance[]> {
  const maintenances = await fromMonitorWorker('/maintenances');
  if (!Array.isArray(maintenances) || !maintenances.every(isValidMaintenance)) {
    throw new Error('Monitor worker sent invalid maintenances');
  }
  return maintenances;
}

/** The hub turned a window down, for a reason the operator can act on. */
export class MaintenanceRefused extends Error {}

export async function saveMaintenance(maintenance: Maintenance): Promise<void> {
  const response = await callMonitorWorker(`/maintenances/${encodeURIComponent(maintenance.id)}`, {
    method: 'PUT',
    body: JSON.stringify(maintenance),
  });
  if (response.status === 400) {
    const body: unknown = await response.json().catch(() => null);
    if (isJsonObject(body) && typeof body.error === 'string') {
      throw new MaintenanceRefused(body.error);
    }
  }
  if (!response.ok) throw new Error(`Saving maintenance answered ${response.status}`);
}

export async function deleteMaintenance(id: string): Promise<boolean> {
  const response = await callMonitorWorker(`/maintenances/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Deleting maintenance answered ${response.status}`);
  return true;
}

/** The last 12 hours, oldest first. */
export async function fetchLatency(monitorId: string): Promise<LatencySample[]> {
  const samples = await fromMonitorWorker(`/latency/${encodeURIComponent(monitorId)}`);
  if (!isLatencySamples(samples)) throw new Error('Monitor worker sent invalid latency');
  return samples;
}

/** Starts a full check run. False instead of an error, so a page render never fails on it. */
export async function triggerCheckRun(): Promise<boolean> {
  const worker = await monitorWorker();
  if (!worker) return false;

  try {
    const response = await worker.fetch('https://internal/trigger', { method: 'POST' });
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

export type CheckNowAnswer = { check: CheckResultWithLocation } | { status: number; error: string };

/**
 * One check of a configured check monitor, recorded nowhere. A refusal (an
 * unknown or heartbeat id) keeps the worker's status and message.
 */
export async function checkMonitorNow(id: string): Promise<CheckNowAnswer> {
  const response = await callMonitorWorker(`/check/${encodeURIComponent(id)}`, { method: 'POST' });
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    if (!isCheckResultWithLocation(body)) throw new Error('Monitor worker sent an invalid check');
    return { check: body };
  }
  const refused = response.status === 400 || response.status === 404;
  if (refused && isJsonObject(body) && typeof body.error === 'string') {
    return { status: response.status, error: body.error };
  }
  throw new Error(`Check now answered ${response.status}`);
}

/**
 * A heartbeat's ping URL; null when unbound or the id is unknown. Without
 * PUBLIC_ORIGIN the worker builds the URL from the origin this sends.
 */
export async function fetchPingUrl(origin: string, id: string): Promise<string | null> {
  const worker = await monitorWorker();
  if (!worker) return null;

  const response = await worker.fetch(`${origin}/ping-url/${encodeURIComponent(id)}`);
  if (!response.ok) return null;

  const body: unknown = await response.json();
  return isJsonObject(body) && typeof body.url === 'string' ? body.url : null;
}

/** Forwards a ping; headers are dropped so cookies and auth never reach the worker. */
export async function forwardPing(request: Request): Promise<Response> {
  const worker = await monitorWorker();
  if (!worker) {
    return new Response('Not Found', { status: 404, headers: PING_RESPONSE_HEADERS });
  }

  try {
    // Streamed, not buffered: the monitoring worker caps the body after it checks the token.
    const forwarded = new Request(request, { headers: {} });
    return await worker.fetch(forwarded);
  } catch (error) {
    console.warn('Failed to forward ping', { error: String(error) });
    return new Response('Not Found', { status: 404, headers: PING_RESPONSE_HEADERS });
  }
}

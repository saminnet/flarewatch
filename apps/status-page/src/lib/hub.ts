import {
  isHubView,
  isLatencySamples,
  type HubView,
  type LatencySample,
  type Maintenance,
} from '@flarewatch/shared';
import { resolveRuntimeEnv } from './runtime-env';

async function callMonitorWorker(path: string, init?: RequestInit): Promise<Response> {
  const { MONITOR_WORKER: monitorWorker } = await resolveRuntimeEnv();
  if (!monitorWorker || typeof monitorWorker.fetch !== 'function') {
    throw new Error('MONITOR_WORKER binding not found');
  }
  return monitorWorker.fetch(`https://internal${path}`, init);
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

export async function saveMaintenance(maintenance: Maintenance): Promise<void> {
  const response = await callMonitorWorker(`/maintenances/${encodeURIComponent(maintenance.id)}`, {
    method: 'PUT',
    body: JSON.stringify(maintenance),
  });
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

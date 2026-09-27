import {
  isLatencySamples,
  isStatusView,
  type LatencySample,
  type StatusView,
} from '@flarewatch/shared';
import { resolveRuntimeEnv } from './runtime-env';

async function fromMonitorWorker(path: string): Promise<unknown> {
  const { MONITOR_WORKER: monitorWorker } = await resolveRuntimeEnv();
  if (!monitorWorker || typeof monitorWorker.fetch !== 'function') {
    throw new Error('MONITOR_WORKER binding not found');
  }
  const response = await monitorWorker.fetch(`https://internal${path}`);
  if (!response.ok) throw new Error(`Monitor worker ${path} answered ${response.status}`);
  return response.json();
}

/** Every monitor the hub has seen, from the monitoring worker. */
export async function fetchStatusView(): Promise<StatusView> {
  const view = await fromMonitorWorker('/view');
  if (!isStatusView(view)) throw new Error('Monitor worker sent an invalid view');
  return view;
}

/** One monitor's latency samples for the last 12 hours, oldest first. */
export async function fetchLatency(monitorId: string): Promise<LatencySample[]> {
  const samples = await fromMonitorWorker(`/latency/${encodeURIComponent(monitorId)}`);
  if (!isLatencySamples(samples)) throw new Error('Monitor worker sent invalid latency');
  return samples;
}

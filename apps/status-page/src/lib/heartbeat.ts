import type { HeartbeatRun, HeartbeatStatus, StatusView } from '@flarewatch/shared';
import { HEARTBEAT_RUN_HISTORY, isJsonObject } from '@flarewatch/shared';
import type { PublicMonitor } from '@/lib/public-view';

export type HeartbeatView = {
  phase: HeartbeatStatus;
  /** Last finished run, success or failure. */
  lastRunSec?: number;
  lastResult?: 'success' | 'fail';
  deadlineSec?: number;
  /** Up phase only: lastRunSec + periodSeconds. The checker deadline includes grace; this does not. */
  nextDueSec?: number;
  startedSec?: number;
  /** Duration of the last finished run, from the run's own startedAt. */
  lastDurationSec?: number;
  /** Failure reason reported by the job, capped by the ping handler. */
  message?: string;
  /** Recent run outcomes incl. cron-detected misses, oldest first. */
  runs?: HeartbeatRun[];
  /** Last check run (unix seconds), which anchors elapsed-time facts. */
  nowSec: number;
};

/** Ping runs plus cron-detected deadline misses, oldest first, capped at HEARTBEAT_RUN_HISTORY. */
export function mergeHeartbeatRuns(
  runs: HeartbeatRun[] | undefined,
  misses: number[] | undefined,
): HeartbeatRun[] {
  return [...(runs ?? []), ...(misses ?? []).map((at): HeartbeatRun => ({ at, outcome: 'miss' }))]
    .sort((a, b) => a.at - b.at)
    .slice(-HEARTBEAT_RUN_HISTORY);
}

/**
 * Seconds the run at index arrived past its previous success's due time
 * (period plus grace, the checker's definition of late). The previous ok or
 * late run is the reference; miss and fail entries are skipped, so
 * [ok, miss, late] measures the recovery. 0 when on time or unknown.
 */
export function runLatenessSec(
  runs: HeartbeatRun[],
  index: number,
  periodSeconds?: number,
  graceSeconds?: number,
): number {
  const run = runs[index];
  if (!run || !periodSeconds) return 0;
  for (let i = index - 1; i >= 0; i--) {
    const prev = runs[i];
    if (prev?.outcome === 'ok' || prev?.outcome === 'late') {
      return Math.max(0, run.at - (prev.at + periodSeconds + (graceSeconds ?? 0)));
    }
  }
  return 0;
}

// Worker-authored phase and deadline keep server and browser rendering identical.
export function deriveHeartbeat(
  monitor: Pick<PublicMonitor, 'id' | 'method' | 'periodSeconds'>,
  state: StatusView,
): HeartbeatView | null {
  if (monitor.method !== 'HEARTBEAT') return null;

  const signal = state.monitors[monitor.id]?.heartbeat;
  if (!signal) return { phase: 'pending', nowSec: state.lastUpdate };

  const { status, deadline, lastSuccess, lastFail, lastStart, message, runs, misses } = signal;
  const failed = lastFail !== undefined;
  const lastRunSec = failed ? lastFail : lastSuccess;
  const mergedRuns = mergeHeartbeatRuns(runs, misses);
  const lastPing = runs?.[runs.length - 1];
  const lastDurationSec =
    lastPing?.startedAt !== undefined && lastPing.startedAt < lastPing.at
      ? lastPing.at - lastPing.startedAt
      : undefined;

  return {
    phase: status,
    nowSec: state.lastUpdate,
    ...(lastRunSec !== undefined && { lastRunSec, lastResult: failed ? 'fail' : 'success' }),
    ...(status === 'up' &&
      lastRunSec !== undefined &&
      monitor.periodSeconds !== undefined && {
        nextDueSec: lastRunSec + monitor.periodSeconds,
      }),
    ...(deadline !== undefined && { deadlineSec: deadline }),
    ...(lastDurationSec !== undefined && { lastDurationSec }),
    ...(lastStart !== undefined && { startedSec: lastStart }),
    ...(message && { message }),
    ...(mergedRuns.length > 0 && { runs: mergedRuns }),
  };
}

/** Asks the monitoring worker for a monitor's ping URL; null when unbound or the id is unknown. */
export async function fetchPingUrl(
  monitorWorker: Cloudflare.Env['MONITOR_WORKER'],
  origin: string,
  id: string,
): Promise<string | null> {
  if (!monitorWorker || typeof monitorWorker.fetch !== 'function') return null;

  const response = await monitorWorker.fetch(`${origin}/ping-url/${encodeURIComponent(id)}`);
  if (!response.ok) return null;

  const body: unknown = await response.json();
  return isJsonObject(body) && typeof body.url === 'string' ? body.url : null;
}

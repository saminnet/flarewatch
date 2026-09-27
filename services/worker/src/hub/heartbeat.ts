import {
  HEARTBEAT_RUN_HISTORY,
  failure,
  formatUtcShort,
  success,
  type CheckResult,
  type HeartbeatMonitor,
  type HeartbeatRun,
  type HeartbeatSignal,
  type HeartbeatState,
} from '@flarewatch/shared';

export type PingKind = 'success' | 'start' | 'fail';

type Evaluation = { result?: CheckResult; heartbeat: HeartbeatState };

function withStatus(
  signal: HeartbeatSignal,
  status: HeartbeatState['status'],
  deadline?: number,
): HeartbeatState {
  return { ...signal, status, ...(deadline !== undefined && { deadline }) };
}

/** A job's status at `now` from its last pings. Pending and running jobs have no check result. */
export function evaluateHeartbeat(
  monitor: HeartbeatMonitor,
  signal: HeartbeatSignal,
  now: number,
): Evaluation {
  const { lastSuccess, lastFail, lastStart } = signal;
  if (lastSuccess === undefined && lastFail === undefined && lastStart === undefined) {
    return { heartbeat: withStatus(signal, 'pending') };
  }

  if (lastFail !== undefined) {
    return {
      result: failure('Job reported failure'),
      heartbeat: withStatus(
        signal,
        'down',
        lastSuccess !== undefined
          ? lastSuccess + monitor.periodSeconds + monitor.graceSeconds
          : undefined,
      ),
    };
  }

  const deadline =
    Math.max(
      lastSuccess === undefined ? Number.NEGATIVE_INFINITY : lastSuccess + monitor.periodSeconds,
      lastStart ?? Number.NEGATIVE_INFINITY,
    ) + monitor.graceSeconds;
  const overdue = (): Evaluation => ({
    result: failure(
      `No heartbeat since ${formatUtcShort((lastSuccess ?? lastStart)!)} (expected by ${formatUtcShort(deadline)})`,
    ),
    heartbeat: withStatus(signal, 'down', deadline),
  });

  if (lastStart !== undefined && (lastSuccess === undefined || lastStart > lastSuccess)) {
    return now <= deadline ? { heartbeat: withStatus(signal, 'running', deadline) } : overdue();
  }
  if (now <= deadline - monitor.graceSeconds) {
    return { result: success(0), heartbeat: withStatus(signal, 'up', deadline) };
  }
  if (now <= deadline) {
    return { result: success(0), heartbeat: withStatus(signal, 'late', deadline) };
  }
  return overdue();
}

/**
 * While a job stays overdue, one miss is appended per elapsed period, so a
 * long outage shows every skipped run.
 */
export function withMisses(
  monitor: HeartbeatMonitor,
  heartbeat: HeartbeatState,
  previousMisses: number[] | undefined,
  now: number,
): HeartbeatState {
  const next: HeartbeatState = previousMisses?.length
    ? { ...heartbeat, misses: previousMisses }
    : heartbeat;
  if (next.status !== 'down' || next.lastFail !== undefined || next.deadline === undefined) {
    return next;
  }

  const period = monitor.periodSeconds;
  const lastMiss = previousMisses?.[previousMisses.length - 1];
  const firstMiss = Math.max(next.deadline, lastMiss === undefined ? -Infinity : lastMiss + period);
  const count = Math.floor((now - firstMiss) / period) + 1;
  if (count <= 0) return next;
  const skipped = Math.max(0, count - HEARTBEAT_RUN_HISTORY);
  const appended = Array.from(
    { length: count - skipped },
    (_, i) => firstMiss + (skipped + i) * period,
  );
  return {
    ...next,
    misses: [...(previousMisses ?? []), ...appended].slice(-HEARTBEAT_RUN_HISTORY),
  };
}

function appendRun(runs: HeartbeatRun[] | undefined, run: HeartbeatRun): HeartbeatRun[] {
  const next = [...(runs ?? [])];
  const last = next[next.length - 1];
  if (last && last.outcome === run.outcome && Math.abs(run.at - last.at) < 30) {
    next[next.length - 1] = run;
  } else {
    next.push(run);
  }
  return next.slice(-HEARTBEAT_RUN_HISTORY);
}

/** The signal after one ping. Status and misses are left for the next check run. */
export function applyPing(
  monitor: HeartbeatMonitor,
  signal: HeartbeatSignal,
  kind: PingKind,
  now: number,
  message?: string,
): HeartbeatSignal {
  const next = { ...signal };
  const makeRun = (outcome: HeartbeatRun['outcome']): HeartbeatRun => ({
    at: now,
    outcome,
    ...(signal.lastStart !== undefined && { startedAt: signal.lastStart }),
  });

  if (kind === 'success') {
    const previousSuccess = signal.lastSuccess;
    const outcome =
      previousSuccess !== undefined &&
      now > previousSuccess + monitor.periodSeconds + monitor.graceSeconds
        ? 'late'
        : 'ok';
    next.runs = appendRun(signal.runs, makeRun(outcome));
    next.lastSuccess = now;
    delete next.lastFail;
    delete next.lastStart;
    delete next.message;
  } else if (kind === 'start') {
    next.lastStart = now;
  } else {
    next.runs = appendRun(signal.runs, makeRun('fail'));
    next.lastFail = now;
    delete next.lastStart;
    next.message = message ?? '';
  }
  return next;
}

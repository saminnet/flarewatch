import {
  type CheckContext,
  type HeartbeatMonitor,
  type HeartbeatSignal,
  type HeartbeatState,
  type MonitorCheckResult,
  failure,
  formatUtcShort,
  heartbeatKvKey,
  parseHeartbeatSignal,
  success,
} from '@flarewatch/shared';

const LOCATION = 'HEARTBEAT';

function withSignal(
  signal: HeartbeatSignal,
  status: HeartbeatState['status'],
  deadline?: number,
): HeartbeatState {
  return { status, ...signal, ...(deadline !== undefined && { deadline }) };
}

function overdueResult(signal: HeartbeatSignal, deadline: number): MonitorCheckResult {
  const since = (signal.lastSuccess ?? signal.lastStart)!;

  return {
    location: LOCATION,
    result: failure(
      `No heartbeat since ${formatUtcShort(since)} (expected by ${formatUtcShort(deadline)})`,
    ),
    heartbeat: withSignal(signal, 'down', deadline),
  };
}

export async function checkHeartbeat(
  monitor: HeartbeatMonitor,
  ctx: CheckContext,
): Promise<MonitorCheckResult> {
  const kv = ctx.stateKv;
  if (!kv) throw new Error('stateKv dependency not provided');

  const stored = await kv.get(heartbeatKvKey(monitor.id), { type: 'json' });
  const signal = parseHeartbeatSignal(stored ?? {});
  if (!signal) {
    return {
      location: LOCATION,
      result: failure(`Invalid heartbeat signal stored for ${monitor.id}`),
      heartbeat: { status: 'down' },
    };
  }

  const { lastSuccess, lastFail, lastStart } = signal;
  if (lastSuccess === undefined && lastFail === undefined && lastStart === undefined) {
    return {
      location: LOCATION,
      heartbeat: withSignal(signal, 'pending'),
    };
  }

  if (lastFail !== undefined) {
    return {
      location: LOCATION,
      result: failure('Job reported failure'),
      heartbeat: withSignal(
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

  if (lastStart !== undefined && (lastSuccess === undefined || lastStart > lastSuccess)) {
    return ctx.now <= deadline
      ? { location: LOCATION, heartbeat: withSignal(signal, 'running', deadline) }
      : overdueResult(signal, deadline);
  }

  if (ctx.now <= deadline - monitor.graceSeconds) {
    return {
      location: LOCATION,
      result: success(0),
      heartbeat: withSignal(signal, 'up', deadline),
    };
  }

  if (ctx.now <= deadline) {
    return {
      location: LOCATION,
      result: success(0),
      heartbeat: withSignal(signal, 'late', deadline),
    };
  }

  return overdueResult(signal, deadline);
}

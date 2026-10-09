import { UPTIME_THRESHOLDS } from './constants';
import type { MonitorState } from './monitor-state';

export type StatusTone = 'operational' | 'degraded' | 'down' | 'unknown';
export type UptimeTone = StatusTone | 'pending';

/** Text tokens that keep AA contrast on the card background. */
export const UPTIME_TEXT: Record<UptimeTone, string> = {
  operational: 'text-status-operational-text',
  degraded: 'text-status-degraded-text',
  down: 'text-status-down-text',
  unknown: 'text-muted-foreground',
  pending: 'text-muted-foreground',
};

const STATE_TONE: Record<MonitorState, UptimeTone> = {
  up: 'operational',
  running: 'operational',
  degraded: 'degraded',
  down: 'down',
  pending: 'pending',
};

export function getStatusTone(percent: number | string | null): StatusTone {
  if (percent === null) return 'unknown';

  const p = Number(percent);
  if (Number.isNaN(p)) return 'unknown';

  if (p >= UPTIME_THRESHOLDS.EXCELLENT) return 'operational';
  if (p >= UPTIME_THRESHOLDS.GOOD) return 'degraded';
  return 'down';
}

/** A heartbeat's uptime counts runs, so its state says more than its percentage. */
export function uptimeTone(
  isHeartbeat: boolean,
  state: MonitorState,
  uptimePercent: number | null,
): UptimeTone {
  return isHeartbeat ? STATE_TONE[state] : getStatusTone(uptimePercent);
}

import { UPTIME_THRESHOLDS } from './constants';

export type StatusColor = {
  bg: string;
  text: string;
  border: string;
};

const UNKNOWN: StatusColor = {
  bg: 'bg-status-unknown',
  text: 'text-status-unknown',
  border: 'border-status-unknown',
};

/**
 * Get token-backed status classes based on uptime percentage.
 * Colors resolve from the `--status-*` runtime contract tokens.
 */
export function getStatusColor(percent: number | string | null): StatusColor {
  if (percent === null) return UNKNOWN;

  const p = Number(percent);
  if (Number.isNaN(p)) return UNKNOWN;

  if (p >= UPTIME_THRESHOLDS.GOOD) {
    return {
      bg: 'bg-status-operational',
      text: 'text-status-operational',
      border: 'border-status-operational',
    };
  }
  if (p >= UPTIME_THRESHOLDS.DEGRADED) {
    return {
      bg: 'bg-status-degraded',
      text: 'text-status-degraded',
      border: 'border-status-degraded',
    };
  }
  return { bg: 'bg-status-down', text: 'text-status-down', border: 'border-status-down' };
}

const HEX_NEUTRAL = '#a3a3a3'; // neutral-400

/**
 * Get hex color based on uptime percentage (for charts)
 */
export function getStatusHexColor(percent: number | string | null, darker = false): string {
  if (percent === null) return HEX_NEUTRAL;

  const p = Number(percent);
  if (Number.isNaN(p)) return HEX_NEUTRAL;

  if (p >= UPTIME_THRESHOLDS.EXCELLENT) {
    return darker ? '#059669' : '#10b981'; // emerald-600 / emerald-500
  }
  if (p >= UPTIME_THRESHOLDS.GOOD) {
    return darker ? '#10b981' : '#34d399'; // emerald-500 / emerald-400
  }
  if (p >= UPTIME_THRESHOLDS.DEGRADED) {
    return '#f59e0b'; // amber-500
  }
  return '#ef4444'; // red-500
}

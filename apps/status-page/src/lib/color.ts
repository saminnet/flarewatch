import { UPTIME_THRESHOLDS } from './constants';

export type StatusColor = {
  bg: string;
  text: string;
  border: string;
};

const NEUTRAL: StatusColor = {
  bg: 'bg-neutral-400',
  text: 'text-neutral-400',
  border: 'border-neutral-400',
};

/**
 * Get Tailwind color classes based on uptime percentage
 */
export function getStatusColor(percent: number | string | null): StatusColor {
  if (percent === null) return NEUTRAL;

  const p = Number(percent);
  if (Number.isNaN(p)) return NEUTRAL;

  if (p >= UPTIME_THRESHOLDS.EXCELLENT) {
    return { bg: 'bg-emerald-500', text: 'text-emerald-500', border: 'border-emerald-500' };
  }
  if (p >= UPTIME_THRESHOLDS.GOOD) {
    return { bg: 'bg-emerald-400', text: 'text-emerald-400', border: 'border-emerald-400' };
  }
  if (p >= UPTIME_THRESHOLDS.DEGRADED) {
    return { bg: 'bg-amber-500', text: 'text-amber-500', border: 'border-amber-500' };
  }
  return { bg: 'bg-red-500', text: 'text-red-500', border: 'border-red-500' };
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

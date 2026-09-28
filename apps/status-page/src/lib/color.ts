import { UPTIME_THRESHOLDS } from './constants';

type StatusColor = {
  bg: string;
  text: string;
  border: string;
};

const UNKNOWN: StatusColor = {
  bg: 'bg-status-unknown',
  text: 'text-status-unknown',
  border: 'border-status-unknown',
};

/** Status classes resolve from the `--status-*` theme tokens. */
export function getStatusColor(percent: number | string | null): StatusColor {
  if (percent === null) return UNKNOWN;

  const p = Number(percent);
  if (Number.isNaN(p)) return UNKNOWN;

  if (p >= UPTIME_THRESHOLDS.EXCELLENT) {
    return {
      bg: 'bg-status-operational',
      text: 'text-status-operational',
      border: 'border-status-operational',
    };
  }
  if (p >= UPTIME_THRESHOLDS.GOOD) {
    return {
      bg: 'bg-status-degraded',
      text: 'text-status-degraded',
      border: 'border-status-degraded',
    };
  }
  return { bg: 'bg-status-down', text: 'text-status-down', border: 'border-status-down' };
}

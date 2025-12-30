export type StatusColor = {
  bg: string;
  text: string;
  border: string;
};

/**
 * Get Tailwind color classes based on uptime percentage
 */
export function getStatusColor(percent: number | string): StatusColor {
  const p = Number(percent);

  if (p >= 99.9) {
    return {
      bg: 'bg-emerald-500',
      text: 'text-emerald-500',
      border: 'border-emerald-500',
    };
  } else if (p >= 99) {
    return {
      bg: 'bg-emerald-400',
      text: 'text-emerald-400',
      border: 'border-emerald-400',
    };
  } else if (p >= 95) {
    return {
      bg: 'bg-amber-500',
      text: 'text-amber-500',
      border: 'border-amber-500',
    };
  } else if (Number.isNaN(p)) {
    return {
      bg: 'bg-neutral-400',
      text: 'text-neutral-400',
      border: 'border-neutral-400',
    };
  } else {
    return {
      bg: 'bg-red-500',
      text: 'text-red-500',
      border: 'border-red-500',
    };
  }
}

/**
 * Get hex color based on uptime percentage (for charts)
 */
export function getStatusHexColor(percent: number | string, darker = false): string {
  const p = Number(percent);

  if (p >= 99.9) {
    return darker ? '#059669' : '#10b981'; // emerald-600 / emerald-500
  } else if (p >= 99) {
    return darker ? '#10b981' : '#34d399'; // emerald-500 / emerald-400
  } else if (p >= 95) {
    return '#f59e0b'; // amber-500
  } else if (Number.isNaN(p)) {
    return '#a3a3a3'; // neutral-400
  } else {
    return '#ef4444'; // red-500
  }
}

/**
 * Get status label based on uptime percentage
 */
export function getStatusLabel(percent: number | string): string {
  const p = Number(percent);

  if (p >= 99.9) return 'Operational';
  if (p >= 99) return 'Good';
  if (p >= 95) return 'Degraded';
  if (Number.isNaN(p)) return 'Unknown';
  return 'Down';
}

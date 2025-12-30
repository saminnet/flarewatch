// Uptime percentage thresholds
export const UPTIME_THRESHOLDS = {
  EXCELLENT: 99.9,
  GOOD: 99,
  DEGRADED: 95,
} as const;

// Time constants in milliseconds
export const TIME_MS = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
} as const;

// Stale data threshold (5 minutes)
export const STALE_THRESHOLD_SECONDS = 300;

// Days to show in uptime bar
export const UPTIME_DAYS = 90;

// Days ahead to show upcoming maintenances
export const UPCOMING_MAINTENANCE_DAYS = 7;

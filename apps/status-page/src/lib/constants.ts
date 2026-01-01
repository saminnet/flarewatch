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

// Time constants in seconds
export const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// Stale data threshold (5 minutes)
export const STALE_THRESHOLD_SECONDS = 300;

// Auto-refresh minimum open time before refreshing (seconds)
export const AUTO_REFRESH_MIN_OPEN_SECONDS = 10;

// Days to show in uptime bar
export const UPTIME_DAYS = 90;

// Days ahead to show upcoming maintenances
export const UPCOMING_MAINTENANCE_DAYS = 7;

// Query stale times in milliseconds
export const QUERY_STALE_TIME = {
  DEFAULT: 30_000, // 30 seconds for KV-backed data
  MONITORS: 5 * 60_000, // 5 minutes for monitor config
} as const;

// Cookie names
export const COOKIE_NAMES = {
  THEME: 'flarewatch_theme',
  UI_PREFS: 'flarewatch_ui_prefs',
} as const;

// Page layout
export const PAGE_CONTAINER_CLASSES = 'container mx-auto max-w-5xl px-4 py-8';

// Status bar mobile display
export const STATUS_BAR = {
  MOBILE_BAR_WIDTH: 8, // w-1.5 (6px) + gap-0.5 (2px)
} as const;

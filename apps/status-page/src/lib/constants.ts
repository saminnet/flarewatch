// Uptime percentage thresholds
export const UPTIME_THRESHOLDS = {
  EXCELLENT: 99.9,
  GOOD: 99,
  DEGRADED: 95,
  PARTIAL: 50,
} as const;

// Time constants in milliseconds
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const TIME_MS = {
  SECOND: SECOND_MS,
  MINUTE: MINUTE_MS,
  HOUR: HOUR_MS,
  DAY: DAY_MS,
  WEEK: 7 * DAY_MS,
} as const;

// Time constants in seconds
export const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

// Stale data threshold (5 minutes)
export const STALE_THRESHOLD_SECONDS = 300;

// Retry interval for initial trigger check (1 minute)
export const INITIAL_TRIGGER_RETRY_MS = 60_000;

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
  MOBILE_BAR_WIDTH: 12, // w-2.5 (10px) + gap-0.5 (2px)
} as const;

// Auth constants
export const AUTH = {
  COOKIE_NAME: 'flarewatch_admin_session',
  SESSION_KEY_PREFIX: 'admin_session:',
  SESSION_TTL_SECONDS: 60 * 60 * 24 * 14, // 14 days

  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 10,
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: 10 * 60, // 10 minutes
  LOGIN_RATE_LIMIT_PREFIX: 'admin_login_fail:',
} as const;

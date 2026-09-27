export const UPTIME_THRESHOLDS = {
  EXCELLENT: 99.9,
  GOOD: 99,
  DEGRADED: 95,
  PARTIAL: 50,
} as const;

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

export const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export const STALE_THRESHOLD_SECONDS = 300;

export const INITIAL_TRIGGER_RETRY_MS = 60_000;

export const AUTO_REFRESH_MIN_OPEN_SECONDS = 10;

export const UPTIME_DAYS = 90;

export const UPCOMING_MAINTENANCE_DAYS = 7;

export const QUERY_STALE_TIME = {
  DEFAULT: 30_000,
  MONITORS: 5 * 60_000,
} as const;

export const COOKIE_NAMES = {
  THEME: 'flarewatch_theme',
  UI_PREFS: 'flarewatch_ui_prefs',
} as const;

export const PAGE_CONTAINER_CLASSES = 'container mx-auto max-w-5xl px-4 py-6';

// Also the loading skeleton's height.
export const CHART_HEIGHT_PX = 150;

export const STATUS_BAR = {
  MOBILE_BAR_WIDTH: 12, // w-2.5 (10px) + gap-0.5 (2px)
} as const;

export const AUTH = {
  COOKIE_NAME: 'flarewatch_admin_session',
  SESSION_KEY_PREFIX: 'admin_session:',
  SESSION_TTL_SECONDS: 60 * 60 * 24 * 14,
} as const;

export const DEFAULT_POWERED_BY_URL = 'https://github.com/saminnet/flarewatch';

// Colors resolve from the `--status-*` theme tokens; "unknown" uses `-bg` so empty data stays muted.
export const STATUS_COLORS = {
  up: 'bg-status-operational',
  down: 'bg-status-down',
  partial: 'bg-status-degraded',
  unknown: 'bg-status-unknown-bg',
} as const;

// Status-bar segments and small dots reuse the same tokens.
export const STATUS_DOT_COLORS = {
  ...STATUS_COLORS,
} as const;

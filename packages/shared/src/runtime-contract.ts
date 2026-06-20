/** Neutral contract for the config/theme data the status page runtime can consume. */

/** Bump on incompatible contract changes. */
export const CONTRACT_VERSION = 1;

/**
 * Themeable CSS custom properties (set as `--<token>`).
 * Base tokens mirror :root; status tokens are reserved for status-color runtime parity.
 */
export const SUPPORTED_THEME_TOKENS = [
  'accent',
  'accent-foreground',
  'background',
  'border',
  'card',
  'card-foreground',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'destructive',
  'foreground',
  'input',
  'muted',
  'muted-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'radius',
  'ring',
  'secondary',
  'secondary-foreground',
  'sidebar',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-ring',
  'status-degraded',
  'status-degraded-bg',
  'status-degraded-border',
  'status-down',
  'status-down-bg',
  'status-down-border',
  'status-maintenance',
  'status-maintenance-bg',
  'status-maintenance-border',
  'status-operational',
  'status-operational-bg',
  'status-operational-border',
  'status-unknown',
  'status-unknown-bg',
  'status-unknown-border',
] as const;

export type SupportedThemeToken = (typeof SUPPORTED_THEME_TOKENS)[number];

/** Theme data the runtime accepts; `themeVars` is raw CSS for an inline <style>. */
export type ThemeContract = {
  themeVars?: string;
};

/** Sequences that could break out of an inline <style>. */
const UNSAFE_THEME_SEQUENCES = ['</style', '<script', 'javascript:'] as const;

/**
 * Safety floor for injected themeVars: guarantees it can't break out of an inline
 * <style>. Returns '' if unsafe or not a non-empty string (no token validation).
 */
export function sanitizeThemeVars(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  const lower = input.toLowerCase();
  for (const sequence of UNSAFE_THEME_SEQUENCES) {
    if (lower.includes(sequence)) return '';
  }
  return input;
}

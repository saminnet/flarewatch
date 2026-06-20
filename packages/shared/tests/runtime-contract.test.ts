import { describe, expect, it } from 'vite-plus/test';
import {
  CONTRACT_VERSION,
  SUPPORTED_THEME_TOKENS,
  sanitizeThemeVars,
} from '../src/runtime-contract';

const STATUS_STATES = ['operational', 'degraded', 'down', 'maintenance', 'unknown'] as const;
const STATUS_TOKEN_SUFFIXES = ['', '-bg', '-border'] as const;

describe('contract metadata', () => {
  it('exposes a positive integer contract version', () => {
    expect(Number.isInteger(CONTRACT_VERSION)).toBe(true);
    expect(CONTRACT_VERSION).toBeGreaterThan(0);
    expect(CONTRACT_VERSION).toBe(1);
  });

  it('lists supported theme tokens with no duplicates', () => {
    expect(SUPPORTED_THEME_TOKENS.length).toBeGreaterThan(0);
    expect(new Set(SUPPORTED_THEME_TOKENS).size).toBe(SUPPORTED_THEME_TOKENS.length);
    expect(SUPPORTED_THEME_TOKENS).toContain('primary');
    expect(SUPPORTED_THEME_TOKENS).toContain('background');
  });

  it('includes reserved status page state tokens', () => {
    for (const state of STATUS_STATES) {
      for (const suffix of STATUS_TOKEN_SUFFIXES) {
        expect(SUPPORTED_THEME_TOKENS).toContain(`status-${state}${suffix}`);
      }
    }
  });
});

describe('sanitizeThemeVars', () => {
  it('passes through safe themeVars unchanged', () => {
    const css = ':root{--primary:oklch(0.67 0.16 58);--radius:0.5rem}';
    expect(sanitizeThemeVars(css)).toBe(css);
  });

  it('rejects style-context breakouts', () => {
    expect(sanitizeThemeVars('a}</style><script>alert(1)</script>')).toBe('');
    expect(sanitizeThemeVars('--x: </STYLE>')).toBe('');
    expect(sanitizeThemeVars('--x: <SCRIPT>')).toBe('');
    expect(sanitizeThemeVars('--bg: url(JavaScript:alert(1))')).toBe('');
  });

  it('returns empty string for non-strings and empty input', () => {
    expect(sanitizeThemeVars(undefined)).toBe('');
    expect(sanitizeThemeVars(null)).toBe('');
    expect(sanitizeThemeVars(123)).toBe('');
    expect(sanitizeThemeVars({})).toBe('');
    expect(sanitizeThemeVars('')).toBe('');
  });
});

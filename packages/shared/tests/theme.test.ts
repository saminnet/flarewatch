import { describe, expect, it } from 'vite-plus/test';
import { SUPPORTED_THEME_TOKENS, sanitizeThemeVars } from '../src/theme';

const STATUS_STATES = ['operational', 'degraded', 'down', 'maintenance', 'unknown'] as const;
const STATUS_TOKEN_SUFFIXES = ['', '-bg', '-border'] as const;

describe('contract metadata', () => {
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
  it('keeps the documented example intact', () => {
    const themeVars = `
      :root {
        --primary: oklch(0.62 0.19 259);
        --status-operational: oklch(0.70 0.17 162);
      }
      .dark {
        --primary: oklch(0.71 0.16 255);
      }
    `;

    expect(sanitizeThemeVars(themeVars)).toBe(
      [
        ':root {',
        '  --primary: oklch(0.62 0.19 259);',
        '  --status-operational: oklch(0.70 0.17 162);',
        '}',
        '.dark {',
        '  --primary: oklch(0.71 0.16 255);',
        '}',
      ].join('\n'),
    );
  });

  it('drops a block with another selector and keeps :root and .dark beside it', () => {
    expect(
      sanitizeThemeVars(
        ':root { --primary: #ff6600 } body { color: red; --primary: red } .dark { --ring: #fff }',
      ),
    ).toBe(':root {\n  --primary: #ff6600;\n}\n.dark {\n  --ring: #fff;\n}');
  });

  it('puts a bare declaration in :root and drops an unknown token', () => {
    expect(sanitizeThemeVars('--brand: #000; --primary: #ff6600; .dark { --ring: #fff }')).toBe(
      ':root {\n  --primary: #ff6600;\n}\n.dark {\n  --ring: #fff;\n}',
    );
  });

  it('keeps a block after a comment', () => {
    expect(sanitizeThemeVars('/* Brand colours */ :root { --primary: #f60; }')).toBe(
      ':root {\n  --primary: #f60;\n}',
    );
  });

  it('keeps a declaration after a comment inside a block', () => {
    expect(sanitizeThemeVars('.dark {\n  /* focus\n  ring */ --ring: #fff;\n}')).toBe(
      '.dark {\n  --ring: #fff;\n}',
    );
  });

  it('drops a value that loads a resource', () => {
    expect(
      sanitizeThemeVars(':root { --background: url(//evil.example/a.png); --ring: #fff }'),
    ).toBe(':root {\n  --ring: #fff;\n}');
    expect(sanitizeThemeVars('--background: URL(a.png)')).toBe('');
  });

  it('keeps only the valid declarations around a </style>', () => {
    expect(
      sanitizeThemeVars(
        '--primary: #fff;</style><script>alert(1)</script>;--ring: red</style>;--radius: 1rem',
      ),
    ).toBe(':root {\n  --primary: #fff;\n  --radius: 1rem;\n}');
  });

  it('drops a value over 200 characters', () => {
    expect(sanitizeThemeVars(`--primary: ${'a'.repeat(200)}`)).toBe(
      `:root {\n  --primary: ${'a'.repeat(200)};\n}`,
    );
    expect(sanitizeThemeVars(`--primary: ${'a'.repeat(201)}`)).toBe('');
  });

  it('returns empty string for non-strings and empty input', () => {
    expect(sanitizeThemeVars(undefined)).toBe('');
    expect(sanitizeThemeVars(null)).toBe('');
    expect(sanitizeThemeVars(123)).toBe('');
    expect(sanitizeThemeVars({})).toBe('');
    expect(sanitizeThemeVars('')).toBe('');
  });
});

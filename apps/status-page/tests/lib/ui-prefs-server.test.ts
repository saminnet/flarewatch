import { describe, expect, it } from 'vite-plus/test';
import { parseUiPrefsCookie, validateUiPrefs } from '@/lib/ui-prefs-server';

const DEFAULT_PREFS = { collapsedGroups: [] };

describe('parseUiPrefsCookie', () => {
  it('returns defaults for absent or malformed cookies', () => {
    expect(parseUiPrefsCookie(undefined)).toStrictEqual(DEFAULT_PREFS);
    expect(parseUiPrefsCookie('')).toStrictEqual(DEFAULT_PREFS);
    expect(parseUiPrefsCookie('{not json')).toStrictEqual(DEFAULT_PREFS);
    expect(parseUiPrefsCookie('[]')).toStrictEqual(DEFAULT_PREFS);
  });

  it('falls back for an invalid array', () => {
    expect(parseUiPrefsCookie(JSON.stringify({ collapsedGroups: 'nope' }))).toStrictEqual(
      DEFAULT_PREFS,
    );
  });

  it('ignores the collapsed monitors older versions stored', () => {
    expect(
      parseUiPrefsCookie(JSON.stringify({ collapsedMonitors: ['a'], collapsedGroups: ['APIs'] })),
    ).toStrictEqual({ collapsedGroups: ['APIs'] });
  });

  it('trims entries, drops empties, and dedupes preserving order', () => {
    const prefs = parseUiPrefsCookie(
      JSON.stringify({ collapsedGroups: ['  b ', 'a', '', 'b', 'a '] }),
    );

    expect(prefs.collapsedGroups).toStrictEqual(['b', 'a']);
  });
});

describe('validateUiPrefs', () => {
  it('rejects non-object payloads and missing or invalid properties', () => {
    expect(() => validateUiPrefs('nope')).toThrow('Invalid UI prefs');
    expect(() => validateUiPrefs(null)).toThrow('Invalid UI prefs');
    expect(() => validateUiPrefs({})).toThrow('Invalid UI prefs properties');
    expect(() => validateUiPrefs({ collapsedGroups: [2] })).toThrow('Invalid UI prefs properties');
  });

  it('enforces the 200-item cookie bound', () => {
    const items = Array.from({ length: 201 }, (_, i) => `g${i}`);

    expect(() => validateUiPrefs({ collapsedGroups: items })).toThrow('UI prefs too large');
  });

  it('accepts exactly 200 items', () => {
    const items = Array.from({ length: 200 }, (_, i) => `g${i}`);

    expect(validateUiPrefs({ collapsedGroups: items }).collapsedGroups).toHaveLength(200);
  });

  it('returns trimmed and deduped arrays', () => {
    expect(validateUiPrefs({ collapsedGroups: [' x ', 'x'] })).toStrictEqual({
      collapsedGroups: ['x'],
    });
  });
});

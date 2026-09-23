import { describe, expect, it } from 'vite-plus/test';
import { parseUiPrefsCookie, validateUiPrefs } from '@/lib/ui-prefs-server';

const DEFAULT_PREFS = { collapsedMonitors: [], collapsedGroups: [] };

describe('parseUiPrefsCookie', () => {
  it('returns defaults for absent or malformed cookies', () => {
    expect(parseUiPrefsCookie(undefined)).toStrictEqual(DEFAULT_PREFS);
    expect(parseUiPrefsCookie('')).toStrictEqual(DEFAULT_PREFS);
    expect(parseUiPrefsCookie('{not json')).toStrictEqual(DEFAULT_PREFS);
    expect(parseUiPrefsCookie('[]')).toStrictEqual(DEFAULT_PREFS);
  });

  it('falls back per key when a value is not an array of strings', () => {
    expect(
      parseUiPrefsCookie(JSON.stringify({ collapsedMonitors: ['a', 1], collapsedGroups: 'nope' })),
    ).toStrictEqual(DEFAULT_PREFS);
  });

  it('trims entries, drops empties, and dedupes preserving order', () => {
    const prefs = parseUiPrefsCookie(
      JSON.stringify({ collapsedMonitors: ['  b ', 'a', '', 'b', 'a '], collapsedGroups: [] }),
    );

    expect(prefs.collapsedMonitors).toStrictEqual(['b', 'a']);
  });
});

describe('validateUiPrefs', () => {
  it('rejects non-object payloads and missing or invalid properties', () => {
    expect(() => validateUiPrefs('nope')).toThrow('Invalid UI prefs');
    expect(() => validateUiPrefs(null)).toThrow('Invalid UI prefs');
    expect(() => validateUiPrefs({})).toThrow('Invalid UI prefs properties');
    expect(() => validateUiPrefs({ collapsedMonitors: 'a', collapsedGroups: [] })).toThrow(
      'Invalid UI prefs properties',
    );
    expect(() => validateUiPrefs({ collapsedMonitors: ['a'], collapsedGroups: [2] })).toThrow(
      'Invalid UI prefs properties',
    );
  });

  it('enforces the 200-item cookie bound', () => {
    const items = Array.from({ length: 201 }, (_, i) => `m${i}`);

    expect(() => validateUiPrefs({ collapsedMonitors: items, collapsedGroups: [] })).toThrow(
      'UI prefs too large',
    );
  });

  it('accepts exactly 200 items', () => {
    const items = Array.from({ length: 200 }, (_, i) => `m${i}`);

    expect(
      validateUiPrefs({ collapsedMonitors: items, collapsedGroups: [] }).collapsedMonitors,
    ).toHaveLength(200);
  });

  it('returns trimmed and deduped arrays', () => {
    expect(validateUiPrefs({ collapsedMonitors: [' x ', 'x'], collapsedGroups: [] })).toStrictEqual(
      {
        collapsedMonitors: ['x'],
        collapsedGroups: [],
      },
    );
  });
});

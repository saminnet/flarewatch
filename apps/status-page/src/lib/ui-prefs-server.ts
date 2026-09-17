import { createServerFn } from '@tanstack/react-start';
import { getCookie, setCookie } from '@tanstack/react-start/server';
import { ONE_YEAR_SECONDS, COOKIE_NAMES } from './constants';

export type UiPrefs = {
  collapsedMonitors: string[];
  collapsedGroups: string[];
};

const DEFAULT_UI_PREFS: UiPrefs = {
  collapsedGroups: [],
  collapsedMonitors: [],
};

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;

  const strings: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    strings.push(trimmed);
  }

  // De-dup, preserve order
  return Array.from(new Set(strings));
}

function parseUiPrefsCookie(cookieValue: string | undefined): UiPrefs {
  if (!cookieValue) return DEFAULT_UI_PREFS;

  try {
    const parsed: unknown = JSON.parse(cookieValue);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_UI_PREFS;

    const collapsedMonitors =
      'collapsedMonitors' in parsed ? parseStringArray(parsed.collapsedMonitors) : null;
    const collapsedGroups =
      'collapsedGroups' in parsed ? parseStringArray(parsed.collapsedGroups) : null;

    return {
      collapsedMonitors: collapsedMonitors ?? DEFAULT_UI_PREFS.collapsedMonitors,
      collapsedGroups: collapsedGroups ?? DEFAULT_UI_PREFS.collapsedGroups,
    };
  } catch {
    return DEFAULT_UI_PREFS;
  }
}

function validateUiPrefs(data: unknown): UiPrefs {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid UI prefs');
  }

  const collapsedMonitors =
    'collapsedMonitors' in data ? parseStringArray(data.collapsedMonitors) : null;
  const collapsedGroups = 'collapsedGroups' in data ? parseStringArray(data.collapsedGroups) : null;

  if (!collapsedMonitors || !collapsedGroups) {
    throw new Error('Invalid UI prefs properties');
  }

  // Keep cookies bounded (avoid >4KB)
  if (collapsedMonitors.length > 200 || collapsedGroups.length > 200) {
    throw new Error('UI prefs too large');
  }

  return { collapsedGroups, collapsedMonitors };
}

export const getUiPrefsServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  return parseUiPrefsCookie(getCookie(COOKIE_NAMES.UI_PREFS));
});

export const setUiPrefsServerFn = createServerFn({ method: 'POST' })
  .validator(validateUiPrefs)
  .handler(async ({ data }) => {
    setCookie(COOKIE_NAMES.UI_PREFS, JSON.stringify(data), {
      maxAge: ONE_YEAR_SECONDS,
      path: '/',
      sameSite: 'lax',
    });
  });

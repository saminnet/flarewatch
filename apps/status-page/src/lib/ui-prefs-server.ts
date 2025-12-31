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
    const parsed = JSON.parse(cookieValue) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_UI_PREFS;

    const obj = parsed as Record<string, unknown>;
    const collapsedMonitors =
      parseStringArray(obj.collapsedMonitors) ?? DEFAULT_UI_PREFS.collapsedMonitors;
    const collapsedGroups =
      parseStringArray(obj.collapsedGroups) ?? DEFAULT_UI_PREFS.collapsedGroups;

    return { collapsedGroups, collapsedMonitors };
  } catch {
    return DEFAULT_UI_PREFS;
  }
}

function validateUiPrefs(data: unknown): UiPrefs {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid UI prefs');
  }

  const obj = data as Record<string, unknown>;
  const collapsedMonitors = parseStringArray(obj.collapsedMonitors);
  const collapsedGroups = parseStringArray(obj.collapsedGroups);

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
  .inputValidator(validateUiPrefs)
  .handler(async ({ data }) => {
    setCookie(COOKIE_NAMES.UI_PREFS, JSON.stringify(data), {
      maxAge: ONE_YEAR_SECONDS,
      path: '/',
      sameSite: 'lax',
    });
  });

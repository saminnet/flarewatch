import { isJsonObject } from '@flarewatch/shared';
import { AUTH } from './constants';

export type SessionData = {
  createdAt: number;
  ip: string | null;
};

export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);

  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [rawKey, ...rawValueParts] = part.split('=');
    if (!rawKey || rawValueParts.length === 0) continue;
    const key = rawKey.trim();
    if (!key) continue;
    const val = rawValueParts.join('=').trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

export function getAdminSessionCookie(cookieHeader: string | null): string | null {
  const cookies = parseCookies(cookieHeader);
  return cookies[AUTH.COOKIE_NAME] ?? null;
}

export async function validateSession(
  kv: KVNamespace,
  sessionId: string,
): Promise<SessionData | null> {
  try {
    const raw = await kv.get(`${AUTH.SESSION_KEY_PREFIX}${sessionId}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSessionData(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isSessionData(value: unknown): value is SessionData {
  if (!isJsonObject(value)) return false;
  return typeof value.createdAt === 'number' && (value.ip === null || typeof value.ip === 'string');
}

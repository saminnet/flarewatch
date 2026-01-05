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

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val; // Fallback to raw value if decode fails
    }
  }
  return out;
}

/**
 * Get the admin session cookie value from a cookie header.
 */
export function getAdminSessionCookie(cookieHeader: string | null): string | null {
  const cookies = parseCookies(cookieHeader);
  return cookies[AUTH.COOKIE_NAME] ?? null;
}

/**
 * Validate a session exists in KV storage.
 */
export async function validateSession(
  kv: KVNamespace,
  sessionId: string,
): Promise<SessionData | null> {
  try {
    const raw = await kv.get(`${AUTH.SESSION_KEY_PREFIX}${sessionId}`);
    if (!raw) return null;
    return JSON.parse(raw) as SessionData;
  } catch {
    // Invalid session data format or KV error
    return null;
  }
}

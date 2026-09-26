import { getCookie } from '@tanstack/react-start/server';
import { validateSession } from './auth-utils';
import { resolveRuntimeEnv } from './runtime-env';
import { AUTH } from './constants';

export async function hasAdminSession(env: Cloudflare.Env): Promise<boolean> {
  const kv = env.STATE_KV ?? env.FLAREWATCH_STATE;
  if (!kv) return false;

  const sessionId = getCookie(AUTH.COOKIE_NAME);
  if (!sessionId) return false;

  try {
    return Boolean(await validateSession(kv, sessionId));
  } catch {
    return false;
  }
}

/**
 * Throws unless the caller carries a valid admin session. Dev without admin
 * credentials configured stays open, matching the auth middleware.
 */
export async function requireAdminAuthenticated(): Promise<void> {
  const env = await resolveRuntimeEnv();
  if (!env.FLAREWATCH_ADMIN_BASIC_AUTH) {
    if (import.meta.env.DEV) return;
    throw new Error('Admin access not configured');
  }
  if (!(await hasAdminSession(env))) throw new Error('Not authenticated');
}

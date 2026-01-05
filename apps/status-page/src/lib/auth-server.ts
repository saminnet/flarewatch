import { createServerFn } from '@tanstack/react-start';
import { getCookie } from '@tanstack/react-start/server';
import { validateSession } from './auth-utils';
import { resolveRuntimeEnv } from './runtime-env';
import { AUTH } from './constants';

export type AdminAuthState = 'authenticated' | 'unauthenticated' | 'not_configured';

/**
 * Server function to check admin authentication status.
 * Uses session cookie to validate against KV storage.
 */
export const checkAdminAuthServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AdminAuthState> => {
    const env = await resolveRuntimeEnv();
    const adminCreds = env?.FLAREWATCH_ADMIN_BASIC_AUTH;

    if (!adminCreds) {
      if (import.meta.env.DEV) return 'authenticated';
      return 'not_configured';
    }

    try {
      const kv = env?.FLAREWATCH_STATE;
      if (!kv) {
        return 'unauthenticated';
      }

      const sessionId = getCookie(AUTH.COOKIE_NAME);
      if (!sessionId) {
        return 'unauthenticated';
      }

      const session = await validateSession(kv, sessionId);
      return session ? 'authenticated' : 'unauthenticated';
    } catch {
      return 'unauthenticated';
    }
  },
);

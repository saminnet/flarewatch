import { createServerFn } from '@tanstack/react-start';
import { resolveRuntimeEnv } from './runtime-env';
import { hasAdminSession } from './admin-auth.server';

export type AdminAuthState = 'authenticated' | 'unauthenticated' | 'not_configured';

export const checkAdminAuthServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AdminAuthState> => {
    const env = await resolveRuntimeEnv();

    if (!env.FLAREWATCH_ADMIN_BASIC_AUTH) {
      if (import.meta.env.DEV) return 'authenticated';
      return 'not_configured';
    }

    return (await hasAdminSession(env)) ? 'authenticated' : 'unauthenticated';
  },
);

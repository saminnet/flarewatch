import { createServerFn } from '@tanstack/react-start';
import { resolveRuntimeEnv } from './runtime-env';
import { getViewer, isSignInConfigured } from './operator.server';

export type AdminAuthState = 'authenticated' | 'unauthenticated' | 'not_configured';

export const checkAdminAuthServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AdminAuthState> => {
    const env = await resolveRuntimeEnv();

    if (!isSignInConfigured(env) && !import.meta.env.DEV) return 'not_configured';
    return (await getViewer()) === 'operator' ? 'authenticated' : 'unauthenticated';
  },
);

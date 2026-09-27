import { createServerFn } from '@tanstack/react-start';
import { parseAuthSecret } from './auth-secret';
import { getConfig, isPrivateOnly } from './config';
import { resolveRuntimeEnv } from './runtime-env';
import { getViewer, isSignInConfigured, type Viewer } from './operator.server';

export type Session = {
  viewer: Viewer;
  /** The operator's username; null for visitors and in dev without sign-in. */
  name: string | null;
  canSignIn: boolean;
  /** Visitors see only the sign-in page. */
  privateOnly: boolean;
};

export const getSessionServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Session> => {
    const env = await resolveRuntimeEnv();
    const viewer = await getViewer();
    const secret = env.FLAREWATCH_ADMIN_BASIC_AUTH;
    return {
      viewer,
      name: viewer === 'operator' && secret ? (parseAuthSecret(secret)?.username ?? null) : null,
      canSignIn: isSignInConfigured(env),
      privateOnly: isPrivateOnly(getConfig(), env),
    };
  },
);

/** Whose page to render: a signed-in operator can ask for the visitor view. */
export function audienceOf(session: Session, view: 'visitor' | undefined): Viewer {
  return session.viewer === 'operator' && view !== 'visitor' ? 'operator' : 'visitor';
}

import { createServerFn } from '@tanstack/react-start';
import { parseAuthSecret } from './auth-secret';
import { getConfig, isPrivateOnly } from './config';
import { resolveRuntimeEnv } from './runtime-env';
import { getRequest } from '@tanstack/react-start/server';
import { accessConfig } from '@flarewatch/config/access';
import { getViewer, isSignInConfigured, sessionName, type Viewer } from './operator.server';

export type Session = {
  viewer: Viewer;
  /** Who is signed in; null for visitors and in dev without sign-in. */
  name: string | null;
  canSignIn: boolean;
  passwordSignIn: boolean;
  providers: { id: string; name: string }[];
  /** Visitors see only the sign-in page. */
  privateOnly: boolean;
};

export const getSessionServerFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Session> => {
    const env = await resolveRuntimeEnv();
    const viewer = await getViewer();
    const secret = env.FLAREWATCH_ADMIN_BASIC_AUTH;
    const providerName = viewer === 'visitor' ? null : await sessionName(env, getRequest());
    const passwordName = secret ? (parseAuthSecret(secret)?.username ?? null) : null;
    return {
      viewer,
      name: viewer === 'visitor' ? null : (providerName ?? passwordName),
      canSignIn: isSignInConfigured(env),
      passwordSignIn: Boolean(secret),
      providers: (accessConfig.providers ?? []).map(({ id, name }) => ({ id, name })),
      privateOnly: isPrivateOnly(getConfig()),
    };
  },
);

/** Whose page to render: anyone signed in can ask for the visitor view. */
export function audienceOf(session: Session, view: 'visitor' | undefined): Viewer {
  return view === 'visitor' ? 'visitor' : session.viewer;
}

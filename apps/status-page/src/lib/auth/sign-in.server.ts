import { isJsonObject, type AccessConfig, type AuthProvider } from '@flarewatch/shared';
import { accessConfig } from '@flarewatch/config/access';
import { principalFor } from './access';
import {
  codeChallenge,
  FLOW_TTL_SECONDS,
  openFlow,
  randomToken,
  safeReturnTo,
  sealFlow,
} from './flow';
import { authorizationUrl, identify, SignInError, type Fetch } from './providers';
import { clientIp, readCookie, sessionCookie, startSession } from '../operator.server';

const FLOW_COOKIE = 'flarewatch_sign_in';
const CALLBACK_PATH = '/auth/callback';

type SignInDeps = { env: Cloudflare.Env; access?: AccessConfig; fetch?: Fetch };

function findProvider(access: AccessConfig, id: string | undefined): AuthProvider | undefined {
  return access.providers?.find((provider) => provider.id === id);
}

function flowCookie(request: Request, value: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  // Lax, not Strict: the browser must send it back on the provider's redirect.
  return `${FLOW_COOKIE}=${value}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

/** Each provider's client secret, from FLAREWATCH_OIDC_SECRETS: {"<provider id>": "<secret>"}. */
function clientSecret(env: Cloudflare.Env, providerId: string): string | undefined {
  try {
    const secrets: unknown = JSON.parse(env.FLAREWATCH_OIDC_SECRETS ?? '{}');
    const secret = isJsonObject(secrets) ? secrets[providerId] : undefined;
    return typeof secret === 'string' ? secret : undefined;
  } catch {
    return undefined;
  }
}

function toLogin(request: Request, error: string): Response {
  const url = new URL('/login', request.url);
  url.searchParams.set('error', error);
  const headers = new Headers({ Location: url.toString() });
  headers.append('Set-Cookie', flowCookie(request, '', 0));
  return new Response(null, { status: 302, headers });
}

/** GET /auth/<provider>: sends the browser to the provider. Writes nothing to storage. */
export async function startSignIn(
  request: Request,
  providerId: string,
  { env, access = accessConfig, fetch: fetchFn = fetch }: SignInDeps,
): Promise<Response> {
  const provider = findProvider(access, providerId);
  if (!provider) return new Response('Not Found', { status: 404 });
  const secret = env.FLAREWATCH_AUTH_SECRET;
  if (!secret) return new Response('FLAREWATCH_AUTH_SECRET is not set', { status: 500 });

  const url = new URL(request.url);
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  try {
    const location = await authorizationUrl(
      provider,
      {
        redirectUri: `${url.origin}${CALLBACK_PATH}`,
        state,
        nonce,
        challenge: await codeChallenge(verifier),
      },
      fetchFn,
    );
    const sealed = await sealFlow(secret, {
      provider: provider.id,
      state,
      nonce,
      verifier,
      returnTo: safeReturnTo(url.searchParams.get('next')),
      expiresAt: Math.floor(Date.now() / 1000) + FLOW_TTL_SECONDS,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: location, 'Set-Cookie': flowCookie(request, sealed, FLOW_TTL_SECONDS) },
    });
  } catch (error) {
    console.warn('Sign-in could not start', { provider: provider.id, error: String(error) });
    return toLogin(request, 'provider');
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** GET /auth/callback: checks the provider's answer and starts a session. */
export async function finishSignIn(
  request: Request,
  { env, access = accessConfig, fetch: fetchFn = fetch }: SignInDeps,
): Promise<Response> {
  const url = new URL(request.url);
  const secret = env.FLAREWATCH_AUTH_SECRET;
  const sealed = readCookie(request, FLOW_COOKIE);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const flow = secret && sealed ? await openFlow(secret, sealed, nowSeconds) : null;
  // The state ties this answer to a sign-in this browser started.
  if (!flow || url.searchParams.get('state') !== flow.state) return toLogin(request, 'expired');

  const provider = findProvider(access, flow.provider);
  const code = url.searchParams.get('code');
  if (!provider || !code) return toLogin(request, 'provider');

  let identity;
  try {
    identity = await identify(
      provider,
      {
        code,
        redirectUri: `${url.origin}${CALLBACK_PATH}`,
        verifier: flow.verifier,
        nonce: flow.nonce,
        clientSecret: clientSecret(env, provider.id),
        nowSeconds,
      },
      fetchFn,
    );
  } catch (error) {
    if (!(error instanceof SignInError)) throw error;
    console.warn('Sign-in failed', { provider: provider.id, error: error.message });
    return toLogin(request, 'provider');
  }

  if (!principalFor(access, identity)) return toLogin(request, 'denied');
  const kv = env.FLAREWATCH_STATE;
  if (!kv) return new Response('FLAREWATCH_STATE binding not found', { status: 500 });

  const sessionId = await startSession(kv, clientIp(request), identity);
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
  headers.append('Set-Cookie', sessionCookie(request, sessionId));
  headers.append('Set-Cookie', flowCookie(request, '', 0));
  // A page, not a redirect: after a cross-site hop the browser would hold back
  // the SameSite=Strict session cookie on a redirect, but sends it here.
  const target = escapeHtml(flow.returnTo);
  return new Response(
    `<!doctype html><meta http-equiv="refresh" content="0;url=${target}"><a href="${target}">Continue</a>`,
    { status: 200, headers },
  );
}

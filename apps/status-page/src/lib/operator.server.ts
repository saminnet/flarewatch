import { getRequest } from '@tanstack/react-start/server';
import { isJsonObject, isNonEmptyString, type AccessConfig } from '@flarewatch/shared';
import { accessConfig } from '@flarewatch/config/access';
import { principalFor, type Identity, type Principal } from './auth/access';
import { AUTH } from './constants';
import { resolveRuntimeEnv } from './runtime-env';

/** Whose page to render. A member sees more than a visitor and edits nothing. */
export type Viewer = 'operator' | 'member' | 'visitor';

type SessionData = {
  createdAt: number;
  ip: string | null;
  /** Absent on password sessions from before provider sign-in. */
  identity?: Identity;
};

const identities = new WeakMap<Request, Promise<Identity | null>>();

export function isSignInConfigured(
  env: Cloudflare.Env,
  access: AccessConfig = accessConfig,
): boolean {
  return Boolean(env.FLAREWATCH_ADMIN_BASIC_AUTH) || (access.providers?.length ?? 0) > 0;
}

function sessionKey(sessionId: string): string {
  return `${AUTH.SESSION_KEY_PREFIX}${sessionId}`;
}

/** A cookie's raw value, or null when the request does not carry it. */
export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const [rawKey, ...rawValueParts] = part.split('=');
    if (rawKey?.trim() === name && rawValueParts.length > 0) return rawValueParts.join('=').trim();
  }
  return null;
}

function sessionIdFrom(request: Request): string | null {
  const value = readCookie(request, AUTH.COOKIE_NAME);
  if (value === null) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isIdentity(value: unknown): value is Identity {
  if (!isJsonObject(value)) return false;
  if (value.kind === 'password') return true;
  return (
    value.kind === 'provider' &&
    isNonEmptyString(value.provider) &&
    typeof value.name === 'string' &&
    (value.email === undefined || typeof value.email === 'string') &&
    typeof value.emailVerified === 'boolean' &&
    Array.isArray(value.groups) &&
    value.groups.every((group) => typeof group === 'string') &&
    (value.githubLogin === undefined || typeof value.githubLogin === 'string')
  );
}

function isSessionData(value: unknown): value is SessionData {
  if (!isJsonObject(value)) return false;
  return (
    typeof value.createdAt === 'number' &&
    (value.ip === null || typeof value.ip === 'string') &&
    (value.identity === undefined || isIdentity(value.identity))
  );
}

async function readIdentity(env: Cloudflare.Env, request: Request): Promise<Identity | null> {
  const kv = env.FLAREWATCH_STATE;
  const sessionId = sessionIdFrom(request);
  if (!kv || !sessionId) return null;
  try {
    const raw = await kv.get(sessionKey(sessionId));
    const session: unknown = raw ? JSON.parse(raw) : null;
    return isSessionData(session) ? (session.identity ?? { kind: 'password' }) : null;
  } catch {
    return null;
  }
}

/** Memoized per request, so the middleware and every server fn in one SSR pass share one KV read. */
function resolveIdentity(env: Cloudflare.Env, request: Request): Promise<Identity | null> {
  let identity = identities.get(request);
  if (!identity) {
    identity = readIdentity(env, request);
    identities.set(request, identity);
  }
  return identity;
}

/**
 * Who sent this request, from the session cookie alone. The role comes from
 * the current access config, not from the session, so removing someone from
 * the config locks them out on their next request. Dev without sign-in
 * configured treats everyone as the operator.
 */
export async function resolvePrincipal(
  env: Cloudflare.Env,
  request: Request,
  access: AccessConfig = accessConfig,
): Promise<Principal | null> {
  if (!isSignInConfigured(env, access)) return import.meta.env.DEV ? { role: 'operator' } : null;
  const identity = await resolveIdentity(env, request);
  return identity && principalFor(access, identity);
}

export async function resolveViewer(env: Cloudflare.Env, request: Request): Promise<Viewer> {
  return (await resolvePrincipal(env, request))?.role ?? 'visitor';
}

export async function getPrincipal(): Promise<Principal | null> {
  return resolvePrincipal(await resolveRuntimeEnv(), getRequest());
}

export async function getViewer(): Promise<Viewer> {
  return (await getPrincipal())?.role ?? 'visitor';
}

export async function requireOperator(): Promise<void> {
  if ((await getViewer()) !== 'operator') throw new Error('Not authenticated');
}

/** The signed-in member, for their snapshot. */
export async function requireMember(): Promise<Extract<Principal, { role: 'member' }>> {
  const principal = await getPrincipal();
  if (principal?.role !== 'member') throw new Error('Not authenticated');
  return principal;
}

/** The name the account menu shows, from the session. */
export async function sessionName(env: Cloudflare.Env, request: Request): Promise<string | null> {
  const identity = await resolveIdentity(env, request);
  return identity?.kind === 'provider' ? identity.name : null;
}

export function clearedSessionCookie(request: Request): string {
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';
  const parts = [`${AUTH.COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** SameSite=Strict: no other site can send a request that carries it. */
export function sessionCookie(request: Request, sessionId: string): string {
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';
  const parts = [
    `${AUTH.COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${AUTH.SESSION_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clientIp(request: Request): string | null {
  const cfIp = request.headers.get('CF-Connecting-IP');
  if (cfIp) return cfIp;
  const forwardedFor = request.headers.get('X-Forwarded-For');
  if (!forwardedFor) return null;
  return forwardedFor.split(',')[0]?.trim() ?? null;
}

export async function startSession(
  kv: KVNamespace,
  ip: string | null,
  identity: Identity,
): Promise<string> {
  const sessionId = crypto.randomUUID();
  const session: SessionData = { createdAt: Date.now(), ip, identity };
  await kv.put(sessionKey(sessionId), JSON.stringify(session), {
    expirationTtl: AUTH.SESSION_TTL_SECONDS,
  });
  return sessionId;
}

export async function endSession(kv: KVNamespace, request: Request): Promise<void> {
  const sessionId = sessionIdFrom(request);
  if (sessionId) await kv.delete(sessionKey(sessionId));
}

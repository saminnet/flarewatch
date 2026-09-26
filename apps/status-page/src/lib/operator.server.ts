import { getRequest } from '@tanstack/react-start/server';
import { isJsonObject } from '@flarewatch/shared';
import { AUTH } from './constants';
import { resolveRuntimeEnv } from './runtime-env';

export type Viewer = 'operator' | 'visitor';

type SessionData = {
  createdAt: number;
  ip: string | null;
};

const viewers = new WeakMap<Request, Promise<Viewer>>();

export function isSignInConfigured(env: Cloudflare.Env): boolean {
  return Boolean(env.FLAREWATCH_ADMIN_BASIC_AUTH);
}

function stateKv(env: Cloudflare.Env): KVNamespace | undefined {
  return env.STATE_KV ?? env.FLAREWATCH_STATE;
}

function sessionKey(sessionId: string): string {
  return `${AUTH.SESSION_KEY_PREFIX}${sessionId}`;
}

function sessionIdFrom(request: Request): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rawValueParts] = part.split('=');
    if (rawKey?.trim() !== AUTH.COOKIE_NAME || rawValueParts.length === 0) continue;
    const value = rawValueParts.join('=').trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

function isSessionData(value: unknown): value is SessionData {
  if (!isJsonObject(value)) return false;
  return typeof value.createdAt === 'number' && (value.ip === null || typeof value.ip === 'string');
}

async function readViewer(env: Cloudflare.Env, request: Request): Promise<Viewer> {
  if (!isSignInConfigured(env)) return import.meta.env.DEV ? 'operator' : 'visitor';
  const kv = stateKv(env);
  const sessionId = sessionIdFrom(request);
  if (!kv || !sessionId) return 'visitor';
  try {
    const raw = await kv.get(sessionKey(sessionId));
    return raw && isSessionData(JSON.parse(raw)) ? 'operator' : 'visitor';
  } catch {
    return 'visitor';
  }
}

/**
 * Who sent this request, from the session cookie alone. Memoized per request,
 * so the middleware and every server fn in one SSR pass share one KV read.
 * Dev without sign-in configured treats everyone as the operator.
 */
export function resolveViewer(env: Cloudflare.Env, request: Request): Promise<Viewer> {
  let viewer = viewers.get(request);
  if (!viewer) {
    viewer = readViewer(env, request);
    viewers.set(request, viewer);
  }
  return viewer;
}

export async function getViewer(): Promise<Viewer> {
  return resolveViewer(await resolveRuntimeEnv(), getRequest());
}

export async function requireOperator(): Promise<void> {
  if ((await getViewer()) !== 'operator') throw new Error('Not authenticated');
}

export async function startSession(kv: KVNamespace, ip: string | null): Promise<string> {
  const sessionId = crypto.randomUUID();
  const session: SessionData = { createdAt: Date.now(), ip };
  await kv.put(sessionKey(sessionId), JSON.stringify(session), {
    expirationTtl: AUTH.SESSION_TTL_SECONDS,
  });
  return sessionId;
}

export async function endSession(kv: KVNamespace, request: Request): Promise<void> {
  const sessionId = sessionIdFrom(request);
  if (sessionId) await kv.delete(sessionKey(sessionId));
}

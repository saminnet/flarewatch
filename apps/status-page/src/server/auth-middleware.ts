import type { RequestServerOptions, RequestServerResult } from '@tanstack/react-start';
import { verifyBasicAuthHeader } from '@/lib/auth-secret';
import { resolveRuntimeEnv } from '@/lib/runtime-env';
import { isSignInConfigured, overSignInLimit, resolveViewer } from '@/lib/operator.server';
import { getConfig, isPrivateOnly } from '@/lib/config';

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** On a private-only page, what a visitor may still reach. Data server fns check for themselves. */
function isOpenToVisitors(pathname: string): boolean {
  return (
    pathname === '/login' || pathname.startsWith('/auth/') || pathname.startsWith('/_serverFn/')
  );
}

function isWriteMethod(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

function hasInvalidOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return origin !== new URL(request.url).origin;
}

type MiddlewareResult = Response | RequestServerResult<any, any, any>;

export async function authMiddlewareServer(
  opts: RequestServerOptions<any, any>,
): Promise<MiddlewareResult> {
  // Ping endpoints carry their own HMAC token, verified by the monitoring
  // worker over the service binding. Basic Auth would break curl and systemd
  // reporters, so they are exempt here.
  if (opts.pathname.startsWith('/ping/')) {
    return opts.next();
  }

  const result = await authorize(opts);
  const env = await resolveRuntimeEnv();
  // What a signed-in person sees must never be stored by a shared cache.
  if ((await resolveViewer(env, opts.request)) !== 'visitor') {
    const response = result instanceof Response ? result : result.response;
    response.headers.set('Cache-Control', 'private, no-store');
  }
  return result;
}

async function authorize(opts: RequestServerOptions<any, any>): Promise<MiddlewareResult> {
  const { request, pathname, next } = opts;
  const env = await resolveRuntimeEnv();

  if (pathname.startsWith('/api/admin')) {
    if (!isSignInConfigured(env)) {
      if (import.meta.env.DEV) {
        return next();
      }
      return new Response('Admin access not configured', { status: 403 });
    }

    // CSRF hardening for cookie-based sessions on admin APIs.
    if (
      pathname.startsWith('/api/admin/') &&
      isWriteMethod(request.method) &&
      hasInvalidOrigin(request)
    ) {
      return jsonError(403, 'Invalid origin');
    }

    if (pathname === '/api/admin/session') {
      return next();
    }

    if ((await resolveViewer(env, request)) === 'operator') {
      return next();
    }

    // Scripts authenticate with the Basic header. Checked only here: PBKDF2
    // verification is too costly to run on every page request.
    const adminCreds = env.FLAREWATCH_ADMIN_BASIC_AUTH;
    const authorization = request.headers.get('Authorization');
    if (adminCreds && authorization) {
      if (await overSignInLimit(env, request)) return jsonError(429, 'Too many attempts');
      if (await verifyBasicAuthHeader(adminCreds, authorization)) return next();
    }

    return jsonError(401, 'Not authenticated');
  }

  if (
    !isOpenToVisitors(pathname) &&
    (await resolveViewer(env, request)) === 'visitor' &&
    isPrivateOnly(getConfig(), env)
  ) {
    return pathname.startsWith('/api/')
      ? jsonError(404, 'Not found')
      : Response.redirect(new URL('/login', request.url), 302);
  }

  return next();
}

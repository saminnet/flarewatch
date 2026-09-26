import type { RequestServerOptions, RequestServerResult } from '@tanstack/react-start';
import { verifyBasicAuthHeader } from '@/lib/auth-secret';
import { resolveRuntimeEnv } from '@/lib/runtime-env';
import { resolveViewer } from '@/lib/operator.server';

function unauthorized(realm: string): Response {
  return new Response('Not authenticated', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${realm}"` },
  });
}

function unauthorizedAdmin(): Response {
  return new Response(JSON.stringify({ error: 'Not authenticated' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

function forbidden(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
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
  // What the operator sees must never be stored by a shared cache.
  if ((await resolveViewer(env, opts.request)) === 'operator') {
    const response = result instanceof Response ? result : result.response;
    response.headers.set('Cache-Control', 'private, no-store');
  }
  return result;
}

async function authorize(opts: RequestServerOptions<any, any>): Promise<MiddlewareResult> {
  const { request, pathname, next } = opts;
  const env = await resolveRuntimeEnv();

  if (pathname.startsWith('/api/admin')) {
    const adminCreds = env.FLAREWATCH_ADMIN_BASIC_AUTH;
    if (!adminCreds) {
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
      return forbidden('Invalid origin');
    }

    if (pathname === '/api/admin/session') {
      return next();
    }

    if ((await resolveViewer(env, request)) === 'operator') {
      return next();
    }

    // Scripts authenticate with the Basic header. Checked only here: PBKDF2
    // verification is too costly to run on every page request.
    if (await verifyBasicAuthHeader(adminCreds, request.headers.get('Authorization'))) {
      return next();
    }

    return unauthorizedAdmin();
  }

  const siteCreds = env.FLAREWATCH_STATUS_PAGE_BASIC_AUTH;
  if (siteCreds && !(await verifyBasicAuthHeader(siteCreds, request.headers.get('Authorization'))))
    return unauthorized('FlareWatch');

  return next();
}

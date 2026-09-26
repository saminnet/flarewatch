import type { RequestServerOptions, RequestServerResult } from '@tanstack/react-start';
import { verifyBasicAuthHeader } from '@/lib/auth-secret';
import { resolveRuntimeEnv } from '@/lib/runtime-env';
import { resolveViewer } from '@/lib/operator.server';

function isAdminRoute(pathname: string): boolean {
  return (
    pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin')
  );
}

function isAdminUIRoute(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

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

export async function authMiddlewareServer(
  opts: RequestServerOptions<any, any>,
): Promise<Response | RequestServerResult<any, any, any>> {
  const { request, pathname, next } = opts;
  const env = await resolveRuntimeEnv();

  // Ping endpoints carry their own HMAC token, verified by the monitoring
  // worker over the service binding. Basic Auth would break curl and systemd
  // reporters, so they are exempt here.
  if (pathname.startsWith('/ping/')) {
    return next();
  }

  if (isAdminRoute(pathname)) {
    const adminCreds = env.FLAREWATCH_ADMIN_BASIC_AUTH;
    if (!adminCreds) {
      if (import.meta.env.DEV) {
        return next();
      }
      // Hide the admin UI when not configured, and block writes.
      if (isAdminUIRoute(pathname)) {
        return new Response('Not found', { status: 404 });
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

    if (isAdminUIRoute(pathname)) {
      return next();
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

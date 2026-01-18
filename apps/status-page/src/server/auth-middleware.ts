import type { RequestServerOptions, RequestServerResult } from '@tanstack/react-start';
import { getAdminSessionCookie, timingSafeEqual, validateSession } from '@/lib/auth-utils';
import { resolveRuntimeEnv } from '@/lib/runtime-env';

function isAdminRoute(pathname: string): boolean {
  return (
    pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin')
  );
}

function isAdminUIRoute(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

function checkBasicAuth(request: Request, expectedCreds: string): boolean {
  const expected = `Basic ${btoa(expectedCreds)}`;
  const authHeader = request.headers.get('Authorization') ?? '';
  // Always perform comparison to prevent timing attacks
  return timingSafeEqual(authHeader, expected);
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

  if (isAdminRoute(pathname)) {
    const adminCreds = env?.FLAREWATCH_ADMIN_BASIC_AUTH;
    if (!adminCreds) {
      // Allow access in development mode
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

    // Allow the admin UI to render a login page when not authenticated.
    if (isAdminUIRoute(pathname)) {
      return next();
    }

    // Allow session endpoints to handle login/logout/status.
    if (pathname === '/api/admin/session') {
      return next();
    }

    // Auth for admin APIs: session cookie OR legacy Basic Auth header.
    const kv = env?.STATE_KV ?? env?.FLAREWATCH_STATE;
    const sessionId = getAdminSessionCookie(request.headers.get('Cookie'));
    if (kv && sessionId) {
      const session = await validateSession(kv, sessionId);
      if (session) {
        return next();
      }
    }

    if (checkBasicAuth(request, adminCreds)) {
      return next();
    }

    return unauthorizedAdmin();
  }

  const siteCreds = env?.FLAREWATCH_STATUS_PAGE_BASIC_AUTH;
  if (siteCreds && !checkBasicAuth(request, siteCreds)) return unauthorized('FlareWatch');

  return next();
}

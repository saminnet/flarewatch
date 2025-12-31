import type { RequestServerOptions, RequestServerResult } from '@tanstack/react-start';
import { resolveRuntimeEnv } from '@/lib/runtime-env';

function isAdminRoute(pathname: string): boolean {
  return (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/api/admin' ||
    pathname.startsWith('/api/admin/')
  );
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function encodeBase64(value: string): string {
  if (typeof btoa === 'function') return btoa(value);
  return Buffer.from(value, 'utf8').toString('base64');
}

function checkBasicAuth(request: Request, expectedCreds: string): boolean {
  const expected = `Basic ${encodeBase64(expectedCreds)}`;
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
        return await next();
      }
      // Hide the admin UI when not configured, and block writes.
      if (pathname === '/admin' || pathname.startsWith('/admin/')) {
        return new Response('Not found', { status: 404 });
      }
      return new Response('Admin access not configured', { status: 403 });
    }

    if (!checkBasicAuth(request, adminCreds)) return unauthorized('FlareWatch Admin');
    return await next();
  }

  const siteCreds = env?.FLAREWATCH_STATUS_PAGE_BASIC_AUTH;
  if (siteCreds && !checkBasicAuth(request, siteCreds)) return unauthorized('FlareWatch');

  return await next();
}

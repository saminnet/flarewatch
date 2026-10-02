import type { RequestServerOptions, RequestServerResult } from '@tanstack/react-start';
import { verifyBasicAuthHeader } from '@/lib/auth-secret';
import { resolveRuntimeEnv } from '@/lib/runtime-env';
import { isSignInConfigured, overSignInLimit, resolveViewer } from '@/lib/operator.server';
import { getConfig, isPrivateOnly } from '@/lib/config';
import { cspNonce } from './csp-nonce';

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** On a private-only page, what a visitor may still reach. Data server fns check for themselves. */
function isOpenToVisitors(pathname: string): boolean {
  return (
    pathname === '/login' || pathname.startsWith('/auth/') || pathname.startsWith('/_serverfn/')
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

function contentSecurityPolicy(nonce: string, framable: boolean): string {
  // Vite's dev server injects inline scripts for HMR and React refresh.
  const devScripts = import.meta.env.DEV ? " 'unsafe-inline' 'unsafe-eval'" : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${devScripts}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(framable ? [] : ["frame-ancestors 'none'"]),
  ].join('; ');
}

type MiddlewareResult = Response | RequestServerResult<any, any, any>;

export async function authMiddlewareServer(
  opts: RequestServerOptions<any, any>,
): Promise<MiddlewareResult> {
  // Ping endpoints carry their own HMAC token, verified by the monitoring
  // worker over the service binding. Basic Auth would break curl and systemd
  // reporters, so they are exempt here.
  if (opts.pathname.toLowerCase().startsWith('/ping/')) {
    return opts.next();
  }

  const result = await authorize(opts);
  const response = result instanceof Response ? result : result.response;
  const pathname = opts.pathname.toLowerCase();
  // Only the embed belongs in another site's frame; a framed sign-in or admin page invites clickjacking.
  response.headers.set(
    'Content-Security-Policy',
    contentSecurityPolicy(cspNonce(opts.request), pathname.startsWith('/embed/')),
  );
  // What a signed-in person or an admin script sees must never be stored by a shared cache.
  const env = await resolveRuntimeEnv();
  if (pathname.startsWith('/api/admin') || (await resolveViewer(env, opts.request)) !== 'visitor') {
    response.headers.set('Cache-Control', 'private, no-store');
  }
  return result;
}

async function authorize(opts: RequestServerOptions<any, any>): Promise<MiddlewareResult> {
  const { request, next } = opts;
  // The router matches routes in any letter case and with a trailing slash, so every gate here must too.
  const pathname = opts.pathname.toLowerCase().replace(/\/+$/, '');
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

    // A check-now call is an outbound check, maybe a paid Globalping one, so it
    // counts for every caller, signed in or not. Once: the Basic branch skips it.
    const countsEveryCall = pathname === '/api/admin/check';
    if (countsEveryCall && (await overSignInLimit(env, request))) {
      return jsonError(429, 'Too many attempts');
    }

    if ((await resolveViewer(env, request)) === 'operator') {
      return next();
    }

    // Scripts authenticate with the Basic header. Checked only here: PBKDF2
    // verification is too costly to run on every page request.
    const adminCreds = env.FLAREWATCH_ADMIN_BASIC_AUTH;
    const authorization = request.headers.get('Authorization');
    if (adminCreds && authorization) {
      if (!countsEveryCall && (await overSignInLimit(env, request))) {
        return jsonError(429, 'Too many attempts');
      }
      if (await verifyBasicAuthHeader(adminCreds, authorization)) return next();
    }

    return jsonError(401, 'Not authenticated');
  }

  if (
    !isOpenToVisitors(pathname) &&
    isPrivateOnly(getConfig()) &&
    (await resolveViewer(env, request)) === 'visitor'
  ) {
    return pathname.startsWith('/api/')
      ? jsonError(404, 'Not found')
      : // Not Response.redirect: its headers are immutable, and the caller adds some.
        new Response(null, {
          status: 302,
          headers: { Location: new URL('/login', request.url).href },
        });
  }

  return next();
}

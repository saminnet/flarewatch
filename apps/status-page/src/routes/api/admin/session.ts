import { createFileRoute } from '@tanstack/react-router';
import { isJsonObject, type JsonValue } from '@flarewatch/shared';
import { endSession, isSignInConfigured, startSession } from '@/lib/operator.server';
import { verifyAuthSecret } from '@/lib/auth-secret';
import { resolveRuntimeEnv, requireStateKv } from '@/lib/runtime-env';
import { AUTH } from '@/lib/constants';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

function jsonResponse(body: JsonValue, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function clearSessionCookie(request: Request): string {
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';
  const parts = [`${AUTH.COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function setSessionCookie(request: Request, sessionId: string): string {
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

function getClientIp(request: Request): string | null {
  const cfIp = request.headers.get('CF-Connecting-IP');
  if (cfIp) return cfIp;
  const forwardedFor = request.headers.get('X-Forwarded-For');
  if (!forwardedFor) return null;
  return forwardedFor.split(',')[0]?.trim() ?? null;
}

export const Route = createFileRoute('/api/admin/session')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const env = await resolveRuntimeEnv();
        const adminCreds = env.FLAREWATCH_ADMIN_BASIC_AUTH;
        if (!adminCreds) {
          return jsonResponse({ error: 'Admin access not configured' }, 404);
        }

        const body: unknown = await request.json().catch(() => null);
        if (!isJsonObject(body)) {
          return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }

        const username = typeof body.username === 'string' ? body.username : '';
        const password = typeof body.password === 'string' ? body.password : '';

        try {
          const ip = getClientIp(request);

          // A rate-limit binding, not a stored counter: failed attempts write nothing.
          const limiter = env.LOGIN_RATE_LIMIT;
          if (limiter && ip && !(await limiter.limit({ key: ip })).success) {
            return jsonResponse({ error: 'Too many attempts. Try again later.' }, 429);
          }

          if (!(await verifyAuthSecret(adminCreds, username, password))) {
            return jsonResponse({ error: 'Invalid credentials' }, 401);
          }

          const kv = await requireStateKv();
          const sessionId = await startSession(kv, ip);

          return jsonResponse({ ok: true }, 200, {
            'Set-Cookie': setSessionCookie(request, sessionId),
          });
        } catch {
          return jsonResponse({ error: 'Internal server error' }, 500);
        }
      },

      DELETE: async ({ request }: { request: Request }) => {
        if (!isSignInConfigured(await resolveRuntimeEnv())) {
          return jsonResponse({ error: 'Admin access not configured' }, 404);
        }

        try {
          const kv = await requireStateKv();
          await endSession(kv, request);
          return new Response(null, {
            status: 204,
            headers: { 'Set-Cookie': clearSessionCookie(request) },
          });
        } catch {
          return jsonResponse({ error: 'Internal server error' }, 500);
        }
      },
    },
  },
});

import { createFileRoute } from '@tanstack/react-router';
import { getAdminSessionCookie, type SessionData } from '@/lib/auth-utils';
import { verifyAuthSecret } from '@/lib/auth-secret';
import { resolveRuntimeEnv, requireStateKv } from '@/lib/runtime-env';
import { AUTH } from '@/lib/constants';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

function jsonResponse(body: object, status: number, headers?: Record<string, string>): Response {
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

async function getLoginFailures(kv: KVNamespace, ip: string): Promise<number> {
  const raw = await kv.get(`${AUTH.LOGIN_RATE_LIMIT_PREFIX}${ip}`);
  if (!raw) return 0;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

async function incrementLoginFailures(kv: KVNamespace, ip: string): Promise<number> {
  const current = await getLoginFailures(kv, ip);
  const next = current + 1;
  await kv.put(`${AUTH.LOGIN_RATE_LIMIT_PREFIX}${ip}`, String(next), {
    expirationTtl: AUTH.LOGIN_RATE_LIMIT_WINDOW_SECONDS,
  });
  return next;
}

async function clearLoginFailures(kv: KVNamespace, ip: string): Promise<void> {
  await kv.delete(`${AUTH.LOGIN_RATE_LIMIT_PREFIX}${ip}`);
}

export const Route = createFileRoute('/api/admin/session')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const env = await resolveRuntimeEnv();
        const adminCreds = env?.FLAREWATCH_ADMIN_BASIC_AUTH;
        if (!adminCreds) {
          return jsonResponse({ error: 'Admin access not configured' }, 404);
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }

        const data = body as Record<string, unknown>;
        const username = typeof data.username === 'string' ? data.username : '';
        const password = typeof data.password === 'string' ? data.password : '';

        try {
          const kv = await requireStateKv();
          const ip = getClientIp(request);

          if (ip) {
            const failures = await getLoginFailures(kv, ip);
            if (failures >= AUTH.LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
              return jsonResponse({ error: 'Too many attempts. Try again later.' }, 429);
            }
          }

          const credentialsOk = await verifyAuthSecret(adminCreds, username, password);
          if (!credentialsOk) {
            if (ip) {
              await incrementLoginFailures(kv, ip);
            }
            return jsonResponse({ error: 'Invalid credentials' }, 401);
          }

          if (ip) {
            await clearLoginFailures(kv, ip);
          }

          const sessionId = crypto.randomUUID();
          const sessionData: SessionData = {
            createdAt: Date.now(),
            ip,
          };
          await kv.put(`${AUTH.SESSION_KEY_PREFIX}${sessionId}`, JSON.stringify(sessionData), {
            expirationTtl: AUTH.SESSION_TTL_SECONDS,
          });

          return jsonResponse({ ok: true }, 200, {
            'Set-Cookie': setSessionCookie(request, sessionId),
          });
        } catch {
          return jsonResponse({ error: 'Internal server error' }, 500);
        }
      },

      DELETE: async ({ request }: { request: Request }) => {
        const env = await resolveRuntimeEnv();
        const adminCreds = env?.FLAREWATCH_ADMIN_BASIC_AUTH;
        if (!adminCreds) {
          return jsonResponse({ error: 'Admin access not configured' }, 404);
        }

        try {
          const kv = await requireStateKv();
          const sessionId = getAdminSessionCookie(request.headers.get('Cookie'));
          if (sessionId) {
            await kv.delete(`${AUTH.SESSION_KEY_PREFIX}${sessionId}`);
          }
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

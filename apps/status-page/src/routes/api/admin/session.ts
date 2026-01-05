import { createFileRoute } from '@tanstack/react-router';
import { getAdminSessionCookie, timingSafeEqual, type SessionData } from '@/lib/auth-utils';
import { resolveRuntimeEnv, requireKv } from '@/lib/runtime-env';
import { AUTH } from '@/lib/constants';

function parseBasicAuthCreds(value: string): { username: string; password: string } | null {
  const idx = value.indexOf(':');
  if (idx <= 0 || idx === value.length - 1) return null;
  return { username: value.slice(0, idx), password: value.slice(idx + 1) };
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

function createSessionId(): string {
  // crypto.randomUUID() is available in both Workers and modern Node.
  return crypto.randomUUID();
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
        const adminCredsRaw = env?.FLAREWATCH_ADMIN_BASIC_AUTH;
        if (!adminCredsRaw) {
          return new Response(JSON.stringify({ error: 'Admin access not configured' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const adminCreds = parseBasicAuthCreds(adminCredsRaw);
        if (!adminCreds) {
          return new Response(JSON.stringify({ error: 'Invalid admin credentials format' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const data = body as Record<string, unknown>;
        const username = typeof data.username === 'string' ? data.username : '';
        const password = typeof data.password === 'string' ? data.password : '';

        try {
          const kv = await requireKv();
          const ip = getClientIp(request);

          if (ip) {
            const failures = await getLoginFailures(kv, ip);
            if (failures >= AUTH.LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
              return new Response(
                JSON.stringify({ error: 'Too many attempts. Try again later.' }),
                {
                  status: 429,
                  headers: { 'Content-Type': 'application/json' },
                },
              );
            }
          }

          const usernameOk = timingSafeEqual(username, adminCreds.username);
          const passwordOk = timingSafeEqual(password, adminCreds.password);

          if (!usernameOk || !passwordOk) {
            if (ip) {
              await incrementLoginFailures(kv, ip);
            }
            return new Response(JSON.stringify({ error: 'Invalid credentials' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          if (ip) {
            await clearLoginFailures(kv, ip);
          }

          const sessionId = createSessionId();
          const sessionData: SessionData = {
            createdAt: Date.now(),
            ip,
          };
          await kv.put(`${AUTH.SESSION_KEY_PREFIX}${sessionId}`, JSON.stringify(sessionData), {
            expirationTtl: AUTH.SESSION_TTL_SECONDS,
          });

          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Set-Cookie': setSessionCookie(request, sessionId),
            },
          });
        } catch {
          return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },

      DELETE: async ({ request }: { request: Request }) => {
        const env = await resolveRuntimeEnv();
        const adminCreds = env?.FLAREWATCH_ADMIN_BASIC_AUTH;
        if (!adminCreds) {
          return new Response(JSON.stringify({ error: 'Admin access not configured' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        try {
          const kv = await requireKv();
          const sessionId = getAdminSessionCookie(request.headers.get('Cookie'));
          if (sessionId) {
            await kv.delete(`${AUTH.SESSION_KEY_PREFIX}${sessionId}`);
          }
          return new Response(null, {
            status: 204,
            headers: { 'Set-Cookie': clearSessionCookie(request) },
          });
        } catch {
          return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
    },
  },
});

import { createFileRoute } from '@tanstack/react-router';
import { isJsonObject, readJsonUpTo, type JsonValue } from '@flarewatch/shared';
import {
  clearedSessionCookie,
  clientIp,
  endSession,
  isSignInConfigured,
  overSignInLimit,
  passwordIdentity,
  sessionCookie,
  startSession,
} from '@/lib/operator.server';
import { verifyAuthSecret } from '@/lib/auth-secret';
import { resolveRuntimeEnv, requireStateKv } from '@/lib/runtime-env';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

function jsonResponse(body: JsonValue, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
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

        // Read before the rate limit, so capped: anyone can send it.
        const body: unknown = await readJsonUpTo(request, 4096).catch(() => null);
        if (!isJsonObject(body)) {
          return jsonResponse({ error: 'Invalid JSON body' }, 400);
        }

        const username = typeof body.username === 'string' ? body.username : '';
        const password = typeof body.password === 'string' ? body.password : '';

        try {
          if (await overSignInLimit(env, request)) {
            return jsonResponse({ error: 'Too many attempts. Try again later.' }, 429);
          }

          if (!(await verifyAuthSecret(adminCreds, username, password))) {
            return jsonResponse({ error: 'Invalid credentials' }, 401);
          }

          const kv = await requireStateKv();
          const sessionId = await startSession(
            kv,
            clientIp(request),
            await passwordIdentity(adminCreds),
          );

          return jsonResponse({ ok: true }, 200, {
            'Set-Cookie': sessionCookie(request, sessionId),
          });
        } catch {
          return jsonResponse({ error: 'Internal server error' }, 500);
        }
      },

      DELETE: async ({ request }: { request: Request }) => {
        const env = await resolveRuntimeEnv();
        if (!isSignInConfigured(env)) {
          return jsonResponse({ error: 'Admin access not configured' }, 404);
        }

        try {
          await requireStateKv();
          await endSession(env, request);
          return new Response(null, {
            status: 204,
            headers: { 'Set-Cookie': clearedSessionCookie(request) },
          });
        } catch {
          return jsonResponse({ error: 'Internal server error' }, 500);
        }
      },
    },
  },
});

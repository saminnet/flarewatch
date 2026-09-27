import { afterEach, describe, expect, it } from 'vite-plus/test';
import { Route } from '@/routes/api/admin/session';
import { AUTH } from '@/lib/constants';
import { memoryKv } from '../helpers/kv';

type SessionHandler = (ctx: { request: Request }) => Promise<Response>;

function getPostHandler(): SessionHandler {
  const options = Route.options as { server?: { handlers?: Record<string, SessionHandler> } };
  const post = options.server?.handlers?.POST;
  if (!post) throw new Error('POST handler not found on the session route');
  return post;
}

const originalEnv = globalThis.__env__;

afterEach(() => {
  globalThis.__env__ = originalEnv;
});

function postRequest(body: string): Request {
  return new Request('https://flarewatch.test/api/admin/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

describe('POST /api/admin/session body guard', () => {
  it('rejects malformed JSON with 400 before touching KV', async () => {
    globalThis.__env__ = { FLAREWATCH_ADMIN_BASIC_AUTH: 'e2e-admin:secret' };

    const response = await getPostHandler()({ request: postRequest('{not json') });

    expect(response.status).toBe(400);
  });

  it('rejects array and scalar JSON bodies with 400 before touching KV', async () => {
    globalThis.__env__ = { FLAREWATCH_ADMIN_BASIC_AUTH: 'e2e-admin:secret' };

    for (const body of ['[]', '[1,2]', '7', '"str"', 'null', 'true']) {
      const response = await getPostHandler()({ request: postRequest(body) });
      expect(response.status).toBe(400);
    }
  });
});

describe('POST /api/admin/session login rate limit', () => {
  function loginRequest(password: string): Request {
    return new Request('https://flarewatch.test/api/admin/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '203.0.113.7',
      },
      body: JSON.stringify({ username: 'e2e-admin', password }),
    });
  }

  it('blocks the next attempt after the failure maximum', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('e2e-password'),
      { name: 'PBKDF2' },
      false,
      ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 100_000 },
      keyMaterial,
      256,
    );
    const secret = JSON.stringify({
      username: 'e2e-admin',
      salt: btoa(String.fromCharCode(...salt)),
      hash: btoa(String.fromCharCode(...new Uint8Array(bits))),
    });
    const kv = memoryKv();
    globalThis.__env__ = { FLAREWATCH_ADMIN_BASIC_AUTH: secret, FLAREWATCH_STATE: kv };

    for (let attempt = 0; attempt < AUTH.LOGIN_RATE_LIMIT_MAX_ATTEMPTS; attempt++) {
      const response = await getPostHandler()({ request: loginRequest('wrong') });
      expect(response.status).toBe(401);
    }

    const blocked = await getPostHandler()({ request: loginRequest('e2e-password') });
    expect(blocked.status).toBe(429);
  });
});

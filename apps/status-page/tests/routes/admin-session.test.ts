import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { Route } from '@/routes/api/admin/session';
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

  it('rejects a body over 4 KiB with 400 before touching KV', async () => {
    globalThis.__env__ = { FLAREWATCH_ADMIN_BASIC_AUTH: 'e2e-admin:secret' };
    const body = JSON.stringify({ username: 'e2e-admin', password: 'x'.repeat(5000) });

    const response = await getPostHandler()({ request: postRequest(body) });

    expect(response.status).toBe(400);
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

  async function adminSecret(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 100_000 },
      keyMaterial,
      256,
    );
    return JSON.stringify({
      username: 'e2e-admin',
      salt: btoa(String.fromCharCode(...salt)),
      hash: btoa(String.fromCharCode(...new Uint8Array(bits))),
    });
  }

  function limiter(allow: boolean) {
    const limit = vi.fn(async (_options: { key: string }) => ({ success: allow }));
    return { limit, binding: { limit } as { limit: typeof limit } & RateLimit };
  }

  it('turns the right password away once the IP is over its limit', async () => {
    const kv = memoryKv();
    const { limit, binding } = limiter(false);
    globalThis.__env__ = {
      FLAREWATCH_ADMIN_BASIC_AUTH: await adminSecret('e2e-password'),
      FLAREWATCH_STATE: kv,
      LOGIN_RATE_LIMIT: binding,
    };

    const blocked = await getPostHandler()({ request: loginRequest('e2e-password') });

    expect(blocked.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.7' });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('refuses to check a password when the rate-limit binding is missing', async () => {
    const kv = memoryKv();
    globalThis.__env__ = {
      FLAREWATCH_ADMIN_BASIC_AUTH: await adminSecret('e2e-password'),
      FLAREWATCH_STATE: kv,
    };

    const response = await getPostHandler()({ request: loginRequest('e2e-password') });

    expect(response.status).toBe(500);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('never keys the limit on a header the client chooses', async () => {
    const { limit, binding } = limiter(true);
    globalThis.__env__ = {
      FLAREWATCH_ADMIN_BASIC_AUTH: await adminSecret('e2e-password'),
      FLAREWATCH_STATE: memoryKv(),
      LOGIN_RATE_LIMIT: binding,
    };

    for (const forwarded of ['198.51.100.1', '198.51.100.2']) {
      await getPostHandler()({
        request: new Request('https://flarewatch.test/api/admin/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwarded },
          body: JSON.stringify({ username: 'e2e-admin', password: 'wrong' }),
        }),
      });
    }

    expect(limit.mock.calls.map(([options]) => options.key)).toEqual(['unknown', 'unknown']);
  });

  it('writes nothing for a wrong password and a session for the right one', async () => {
    const kv = memoryKv();
    globalThis.__env__ = {
      FLAREWATCH_ADMIN_BASIC_AUTH: await adminSecret('e2e-password'),
      FLAREWATCH_STATE: kv,
      LOGIN_RATE_LIMIT: limiter(true).binding,
    };

    const wrong = await getPostHandler()({ request: loginRequest('wrong') });
    expect(wrong.status).toBe(401);
    expect(kv.put).not.toHaveBeenCalled();

    const right = await getPostHandler()({ request: loginRequest('e2e-password') });
    expect(right.status).toBe(200);
    expect(kv.put).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, describe, expect, it } from 'vite-plus/test';
import { Route } from '@/routes/api/admin/session';

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

  it('still rejects when no state KV binding exists, proving the guard runs first', async () => {
    globalThis.__env__ = { FLAREWATCH_ADMIN_BASIC_AUTH: 'e2e-admin:secret' };

    const response = await getPostHandler()({ request: postRequest('[]') });

    expect(response.status).toBe(400);
  });
});

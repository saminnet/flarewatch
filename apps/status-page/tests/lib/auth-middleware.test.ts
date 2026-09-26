import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { authMiddlewareServer } from '@/server/auth-middleware';
import { buildAuthSecret } from '../helpers/auth-secret';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function call(pathname: string, init?: RequestInit) {
  const next = vi.fn(async () => new Response('next'));
  const request = new Request(`https://status.test${pathname}`, init);
  return { next, response: authMiddlewareServer({ request, pathname, next } as never) };
}

function sessionKv(validId: string) {
  return {
    get: async (key: string) =>
      key === `admin_session:${validId}`
        ? JSON.stringify({ createdAt: 123, ip: '127.0.0.1' })
        : null,
    put: async () => {},
    delete: async () => {},
  };
}

describe('auth middleware ping exemption', () => {
  it('does not gate ping routes with site Basic Auth', async () => {
    vi.stubGlobal('__env__', { FLAREWATCH_STATUS_PAGE_BASIC_AUTH: 'admin:secret' });

    const { next, response } = call('/ping/backup/t0k3n');

    const result = await response;
    expect(result).toBeInstanceOf(Response);
    await expect((result as Response).text()).resolves.toBe('next');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('still gates other routes with site Basic Auth', async () => {
    vi.stubGlobal('__env__', { FLAREWATCH_STATUS_PAGE_BASIC_AUTH: 'admin:secret' });

    const { next, response } = call('/');

    const result = await response;
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('auth middleware admin sessions', () => {
  function callAdminApi(headers: Record<string, string>) {
    const next = vi.fn(async () => new Response('next'));
    const request = new Request('https://status.test/api/admin/maintenances', { headers });
    return {
      next,
      response: authMiddlewareServer({
        request,
        pathname: '/api/admin/maintenances',
        next,
      } as never),
    };
  }

  it('authorizes admin APIs from a valid session only', async () => {
    const validId = 'session=abc+123';
    vi.stubGlobal('__env__', {
      FLAREWATCH_ADMIN_BASIC_AUTH: 'admin:secret',
      STATE_KV: sessionKv(validId),
    });

    const noCookie = callAdminApi({});
    expect(((await noCookie.response) as Response).status).toBe(401);
    expect(noCookie.next).not.toHaveBeenCalled();

    const badSession = callAdminApi({ Cookie: 'flarewatch_admin_session=forged' });
    expect(((await badSession.response) as Response).status).toBe(401);
    expect(badSession.next).not.toHaveBeenCalled();

    const valid = callAdminApi({
      Cookie: `flarewatch_admin_session=${encodeURIComponent(validId)}`,
    });
    await expect(((await valid.response) as Response).text()).resolves.toBe('next');
    expect(valid.next).toHaveBeenCalledTimes(1);
  });
});

describe('auth middleware admin access', () => {
  const basic = (user: string, password: string) => `Basic ${btoa(`${user}:${password}`)}`;

  it('accepts the admin Basic header on admin APIs for scripts', async () => {
    vi.stubGlobal('__env__', {
      FLAREWATCH_ADMIN_BASIC_AUTH: await buildAuthSecret('ops', 's3cret'),
    });

    const good = call('/api/admin/maintenances', {
      headers: { Authorization: basic('ops', 's3cret') },
    });
    await expect(((await good.response) as Response).text()).resolves.toBe('next');

    const bad = call('/api/admin/maintenances', {
      headers: { Authorization: basic('ops', 'wrong') },
    });
    expect(((await bad.response) as Response).status).toBe(401);
    expect(bad.next).not.toHaveBeenCalled();
  });

  it('hides admin routes in production when sign-in is not configured', async () => {
    vi.stubGlobal('__env__', {});
    vi.stubEnv('DEV', false);

    const page = call('/admin');
    expect(((await page.response) as Response).status).toBe(404);
    expect(page.next).not.toHaveBeenCalled();

    const api = call('/api/admin/maintenances', { method: 'POST' });
    expect(((await api.response) as Response).status).toBe(403);
    expect(api.next).not.toHaveBeenCalled();
  });

  it('leaves admin routes open in dev when sign-in is not configured', async () => {
    vi.stubGlobal('__env__', {});
    vi.stubEnv('DEV', true);

    const { next, response } = call('/api/admin/maintenances', { method: 'POST' });
    await expect(((await response) as Response).text()).resolves.toBe('next');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-origin admin writes even with a valid session', async () => {
    vi.stubGlobal('__env__', {
      FLAREWATCH_ADMIN_BASIC_AUTH: 'configured',
      STATE_KV: sessionKv('abc'),
    });
    const cookie = 'flarewatch_admin_session=abc';

    const foreign = call('/api/admin/maintenances', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'https://evil.test' },
    });
    const rejected = (await foreign.response) as Response;
    expect(rejected.status).toBe(403);
    await expect(rejected.json()).resolves.toEqual({ error: 'Invalid origin' });
    expect(foreign.next).not.toHaveBeenCalled();

    const sameOrigin = call('/api/admin/maintenances', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'https://status.test' },
    });
    await expect(((await sameOrigin.response) as Response).text()).resolves.toBe('next');
  });
});

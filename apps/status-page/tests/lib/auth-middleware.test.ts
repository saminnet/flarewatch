import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { authMiddlewareServer } from '@/server/auth-middleware';

afterEach(() => {
  vi.unstubAllGlobals();
});

function call(pathname: string) {
  const next = vi.fn(async () => new Response('next'));
  const request = new Request(`https://status.test${pathname}`);
  return { next, response: authMiddlewareServer({ request, pathname, next } as never) };
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

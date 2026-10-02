import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { pageConfig } from '@flarewatch/config';
import { accessConfig } from '@flarewatch/config/access';
import { passwordIdentity } from '@/lib/operator.server';
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

function sessionKv(validId: string, secret = 'configured') {
  return {
    get: async (key: string) =>
      key === `admin_session:${validId}`
        ? JSON.stringify({
            createdAt: 123,
            ip: '127.0.0.1',
            identity: await passwordIdentity(secret),
          })
        : null,
    put: async () => {},
    delete: async () => {},
  };
}

describe('auth middleware private-only pages', () => {
  const { visibility } = pageConfig;
  afterEach(() => {
    pageConfig.visibility = visibility;
  });

  function privateEnv(
    extra: Partial<Cloudflare.Env> = {},
    pageVisibility: 'public' | 'private' = 'private',
  ) {
    pageConfig.visibility = pageVisibility;
    vi.stubGlobal('__env__', {
      FLAREWATCH_ADMIN_BASIC_AUTH: 'configured',
      FLAREWATCH_STATE: sessionKv('abc'),
      ...extra,
    });
  }

  async function outcome(pathname: string, cookie?: string): Promise<string> {
    const { next, response } = call(pathname, cookie ? { headers: { Cookie: cookie } } : {});
    const result = (await response) as Response;
    if (next.mock.calls.length > 0) return 'next';
    return `${result.status} ${result.headers.get('Location') ?? ''}`.trim();
  }

  it('sends visitors to the sign-in page and hides the public API', async () => {
    privateEnv();

    await expect(outcome('/')).resolves.toBe('302 https://status.test/login');
    await expect(outcome('/monitors/demo_example')).resolves.toBe('302 https://status.test/login');
    await expect(outcome('/embed/demo_example')).resolves.toBe('302 https://status.test/login');
    await expect(outcome('/api/data')).resolves.toBe('404');
    await expect(outcome('/api/badge')).resolves.toBe('404');
  });

  it('keeps sign-in, server functions and pings reachable for visitors', async () => {
    privateEnv();

    await expect(outcome('/login')).resolves.toBe('next');
    await expect(outcome('/_serverFn/abc')).resolves.toBe('next');
    await expect(outcome('/ping/backup/t0k3n')).resolves.toBe('next');
    await expect(outcome('/api/admin/session')).resolves.toBe('next');
    await expect(outcome('/auth/pocket-id')).resolves.toBe('next');
    await expect(outcome('/auth/callback?code=x&state=y')).resolves.toBe('next');
    await expect(outcome('/authors')).resolves.toBe('302 https://status.test/login');
  });

  it('lets the signed-in operator through', async () => {
    privateEnv();

    await expect(outcome('/', 'flarewatch_admin_session=abc')).resolves.toBe('next');
    await expect(outcome('/api/data', 'flarewatch_admin_session=abc')).resolves.toBe('next');
  });

  it('leaves a public page open', async () => {
    privateEnv({}, 'public');

    await expect(outcome('/')).resolves.toBe('next');
    await expect(outcome('/api/data')).resolves.toBe('next');
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
      FLAREWATCH_STATE: sessionKv(validId, 'admin:secret'),
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
      LOGIN_RATE_LIMIT: { limit: async () => ({ success: true }) },
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

  it('counts every Basic header attempt against the sign-in rate limit', async () => {
    vi.stubGlobal('__env__', {
      FLAREWATCH_ADMIN_BASIC_AUTH: await buildAuthSecret('ops', 's3cret'),
      LOGIN_RATE_LIMIT: { limit: async () => ({ success: false }) },
    });

    const limited = call('/api/admin/maintenances', {
      headers: { Authorization: basic('ops', 's3cret'), 'CF-Connecting-IP': '203.0.113.9' },
    });
    expect(((await limited.response) as Response).status).toBe(429);
    expect(limited.next).not.toHaveBeenCalled();
  });

  describe('with provider sign-in only', () => {
    afterEach(() => {
      delete accessConfig.providers;
      delete accessConfig.operators;
    });

    it('lets the operator reach admin APIs and anyone sign out', async () => {
      accessConfig.providers = [
        { id: 'pocket-id', name: 'Pocket ID', issuer: 'https://id.test', clientId: 'fw' },
      ];
      accessConfig.operators = ['op@example.com'];
      const identity = {
        kind: 'provider',
        provider: 'pocket-id',
        name: 'Op',
        email: 'op@example.com',
        emailVerified: true,
        groups: [],
      };
      vi.stubGlobal('__env__', {
        FLAREWATCH_STATE: {
          get: async (key: string) =>
            key === 'admin_session:abc'
              ? JSON.stringify({ createdAt: 1, ip: null, identity })
              : null,
        },
      });
      vi.stubEnv('DEV', false);

      const edit = call('/api/admin/maintenances', {
        headers: { Cookie: 'flarewatch_admin_session=abc' },
      });
      await expect(((await edit.response) as Response).text()).resolves.toBe('next');

      const signOut = call('/api/admin/session', { method: 'DELETE' });
      await expect(((await signOut.response) as Response).text()).resolves.toBe('next');

      const stranger = call('/api/admin/maintenances');
      expect(((await stranger.response) as Response).status).toBe(401);
    });
  });

  it('blocks admin APIs in production when sign-in is not configured', async () => {
    vi.stubGlobal('__env__', {});
    vi.stubEnv('DEV', false);

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
      FLAREWATCH_STATE: sessionKv('abc'),
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

describe('auth middleware caching', () => {
  function renderPage(cookie?: string) {
    const page = new Response('page', { headers: { 'Cache-Control': 'public, max-age=60' } });
    const next = vi.fn(async () => ({ response: page }));
    const request = new Request(
      'https://status.test/',
      cookie ? { headers: { Cookie: cookie } } : {},
    );
    return authMiddlewareServer({ request, pathname: '/', next } as never).then(() =>
      page.headers.get('Cache-Control'),
    );
  }

  it('keeps pages rendered for the operator out of shared caches', async () => {
    vi.stubGlobal('__env__', {
      FLAREWATCH_ADMIN_BASIC_AUTH: 'configured',
      FLAREWATCH_STATE: sessionKv('abc'),
    });

    await expect(renderPage('flarewatch_admin_session=abc')).resolves.toBe('private, no-store');
    await expect(renderPage('flarewatch_admin_session=forged')).resolves.toBe('public, max-age=60');
    await expect(renderPage()).resolves.toBe('public, max-age=60');
  });

  it('keeps admin API answers to scripts out of shared caches', async () => {
    vi.stubGlobal('__env__', {
      FLAREWATCH_ADMIN_BASIC_AUTH: await buildAuthSecret('ops', 's3cret'),
      LOGIN_RATE_LIMIT: { limit: async () => ({ success: true }) },
    });

    const { response } = call('/api/admin/maintenances', {
      headers: { Authorization: `Basic ${btoa('ops:s3cret')}` },
    });

    expect(((await response) as Response).headers.get('Cache-Control')).toBe('private, no-store');
  });
});

describe('auth middleware content security policy', () => {
  const { visibility } = pageConfig;
  afterEach(() => {
    pageConfig.visibility = visibility;
  });

  const policy = async (pathname: string) =>
    ((await call(pathname).response) as Response).headers.get('Content-Security-Policy') ?? '';

  const directive = async (pathname: string, name: string) =>
    (await policy(pathname))
      .split('; ')
      .find((entry) => entry.startsWith(`${name} `))
      ?.slice(name.length + 1);

  const nonceOf = async (pathname: string) =>
    /'nonce-([^']+)'/.exec((await directive(pathname, 'script-src')) ?? '')?.[1];

  it('lets other sites frame the embed only', async () => {
    vi.stubGlobal('__env__', {});

    await expect(directive('/', 'frame-ancestors')).resolves.toBe("'none'");
    await expect(directive('/login', 'frame-ancestors')).resolves.toBe("'none'");
    await expect(directive('/api/admin/maintenances', 'frame-ancestors')).resolves.toBe("'none'");
    await expect(directive('/embed/demo_example', 'frame-ancestors')).resolves.toBeUndefined();
    await expect(directive('/Embed/demo_example', 'frame-ancestors')).resolves.toBeUndefined();
  });

  it('forbids framing the sign-in redirect of a private page', async () => {
    pageConfig.visibility = 'private';
    vi.stubGlobal('__env__', { FLAREWATCH_ADMIN_BASIC_AUTH: 'configured' });

    await expect(directive('/', 'frame-ancestors')).resolves.toBe("'none'");
  });

  it('allows only same-origin scripts and those carrying the request nonce', async () => {
    vi.stubGlobal('__env__', {});
    vi.stubEnv('DEV', false);

    const header = await policy('/');
    const nonce = /'nonce-([A-Za-z0-9_-]{43})'/.exec(header)?.[1];
    expect(header).toBe(
      `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
    );
    await expect(directive('/embed/demo_example', 'script-src')).resolves.toMatch(
      /^'self' 'nonce-[A-Za-z0-9_-]{43}'$/,
    );
  });

  it('gives every request its own nonce', async () => {
    vi.stubGlobal('__env__', {});

    const first = await nonceOf('/');
    const second = await nonceOf('/');
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it('allows inline scripts and eval in dev only, for HMR', async () => {
    vi.stubGlobal('__env__', {});
    vi.stubEnv('DEV', true);

    await expect(directive('/', 'script-src')).resolves.toMatch(
      /^'self' 'nonce-[A-Za-z0-9_-]{43}' 'unsafe-inline' 'unsafe-eval'$/,
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { accessConfig } from '@flarewatch/config/access';
import type { Identity } from '@/lib/auth/access';
import { passwordIdentity } from '@/lib/operator.server';
import { Route } from '@/routes/api/admin/check';
import { authMiddlewareServer } from '@/server/auth-middleware';
import { buildAuthSecret } from '../helpers/auth-secret';

type Handler = (ctx: { request: Request }) => Promise<Response>;

function postHandler(): Handler {
  const options = Route.options as { server?: { handlers?: Record<string, Handler> } };
  const post = options.server?.handlers?.POST;
  if (!post) throw new Error('POST handler not found on the check route');
  return post;
}

const ADMIN_SECRET = await buildAuthSecret('ops', 's3cret');
const OPS_AUTH = { Authorization: `Basic ${btoa('ops:s3cret')}` };
const CHECK = { location: 'FRA', result: { ok: false, error: 'HTTP 503', latency: 87 } };

/** The request as the app serves it: the auth middleware first, then the route. */
async function callCheck(
  headers: Record<string, string>,
  body = JSON.stringify({ id: 'api' }),
  pathname = '/api/admin/check',
): Promise<Response> {
  const request = new Request(`https://status.test${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
  const next = () => postHandler()({ request });
  return (await authMiddlewareServer({
    request,
    pathname,
    next,
  } as never)) as Response;
}

/** The monitor worker behind the binding answers with `answer`. */
async function stubEnv({
  answer = () => Response.json(CHECK),
  limited = false,
  perMinute,
  sessions = {},
}: {
  answer?: () => Response | Promise<Response>;
  limited?: boolean;
  /** Calls the limiter lets through per IP, like LOGIN_RATE_LIMIT's 5 a minute. */
  perMinute?: number;
  sessions?: Record<string, { createdAt: number; ip: string | null; identity: Identity }>;
} = {}) {
  const worker = vi.fn(async (_input: string, _init?: RequestInit) => answer());
  const calls = new Map<string, number>();
  vi.stubGlobal('__env__', {
    FLAREWATCH_ADMIN_BASIC_AUTH: ADMIN_SECRET,
    LOGIN_RATE_LIMIT: {
      limit: async ({ key }: { key: string }) => {
        calls.set(key, (calls.get(key) ?? 0) + 1);
        return { success: !limited && (perMinute === undefined || calls.get(key)! <= perMinute) };
      },
    },
    FLAREWATCH_STATE: {
      get: async (key: string) => {
        const session = sessions[key.replace('admin_session:', '')];
        return session ? JSON.stringify(session) : null;
      },
    },
    MONITOR_WORKER: { fetch: worker },
  });
  return worker;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete accessConfig.providers;
  delete accessConfig.members;
});

describe('POST /api/admin/check', () => {
  it('runs one check for an operator script and keeps the answer out of shared caches', async () => {
    const worker = await stubEnv();

    const response = await callCheck(OPS_AUTH);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(CHECK);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(worker).toHaveBeenCalledTimes(1);
    expect(worker).toHaveBeenCalledWith('https://internal/check/api', { method: 'POST' });
  });

  it('runs it for the operator signed in on the page', async () => {
    const identity = await passwordIdentity(ADMIN_SECRET);
    const worker = await stubEnv({
      sessions: { op: { createdAt: 1, ip: null, identity } },
    });

    const response = await callCheck({
      Cookie: 'flarewatch_admin_session=op',
      Origin: 'https://status.test',
    });

    expect(response.status).toBe(200);
    expect(worker).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no auth', {}, 401],
    ['a wrong password', { Authorization: `Basic ${btoa('ops:guess')}` }, 401],
    ['another origin', { ...OPS_AUTH, Origin: 'https://evil.test' }, 403],
  ])('refuses %s without checking', async (_name, headers, status) => {
    const worker = await stubEnv();

    expect((await callCheck(headers)).status).toBe(status);
    expect(worker).not.toHaveBeenCalled();
  });

  it('refuses a member without checking', async () => {
    accessConfig.providers = [
      { id: 'pocket-id', name: 'Pocket ID', issuer: 'https://id.test', clientId: 'fw' },
    ];
    accessConfig.members = ['member@example.com'];
    const identity: Identity = {
      kind: 'provider',
      provider: 'pocket-id',
      name: 'Member',
      email: 'member@example.com',
      emailVerified: true,
      groups: [],
    };
    const worker = await stubEnv({ sessions: { member: { createdAt: 1, ip: null, identity } } });

    const response = await callCheck({
      Cookie: 'flarewatch_admin_session=member',
      Origin: 'https://status.test',
    });

    expect(response.status).toBe(401);
    expect(worker).not.toHaveBeenCalled();
  });

  it('counts a script call against the sign-in limit', async () => {
    const worker = await stubEnv({ limited: true });

    const response = await callCheck({ ...OPS_AUTH, 'CF-Connecting-IP': '203.0.113.9' });

    expect(response.status).toBe(429);
    expect(worker).not.toHaveBeenCalled();
  });

  // The router serves the check route at each of these spellings.
  it.each(['/api/admin/check', '/api/admin/check/', '/api/admin/CHECK/'])(
    "refuses a signed-in operator's sixth call in a minute from one IP at %s",
    async (pathname) => {
      const identity = await passwordIdentity(ADMIN_SECRET);
      const worker = await stubEnv({
        perMinute: 5,
        sessions: { op: { createdAt: 1, ip: null, identity } },
      });
      const headers = {
        Cookie: 'flarewatch_admin_session=op',
        Origin: 'https://status.test',
        'CF-Connecting-IP': '203.0.113.9',
      };

      const call = () => callCheck(headers, undefined, pathname);
      for (let count = 1; count <= 5; count++) expect((await call()).status).toBe(200);
      expect((await call()).status).toBe(429);
      expect(worker).toHaveBeenCalledTimes(5);
    },
  );

  it('counts a script call once, not twice', async () => {
    const worker = await stubEnv({ perMinute: 5 });
    const headers = { ...OPS_AUTH, 'CF-Connecting-IP': '203.0.113.9' };

    for (let call = 1; call <= 5; call++) expect((await callCheck(headers)).status).toBe(200);
    expect((await callCheck(headers)).status).toBe(429);
    expect(worker).toHaveBeenCalledTimes(5);
  });

  it.each([
    ['no id', JSON.stringify({})],
    ['an empty id', JSON.stringify({ id: '' })],
    ['a target', JSON.stringify({ id: 'api', target: 'https://evil.test' })],
    ['a proxy', JSON.stringify({ id: 'api', checkProxy: 'https://evil.test/check' })],
    ['a body that is not JSON', 'api'],
  ])('refuses a body with %s without checking', async (_name, body) => {
    const worker = await stubEnv();

    expect((await callCheck(OPS_AUTH, body)).status).toBe(400);
    expect(worker).not.toHaveBeenCalled();
  });

  it.each([
    [404, 'Unknown monitor'],
    [400, 'A heartbeat monitor has no check to run'],
  ])('passes on a %i refusal from the worker', async (status, error) => {
    await stubEnv({ answer: () => Response.json({ error }, { status }) });

    const response = await callCheck(OPS_AUTH);

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error });
  });

  it.each([
    ['an answer that is no check result', () => Response.json({ location: 'FRA' })],
    ['a failed call', () => Promise.reject(new Error('binding down'))],
    ['a worker error', () => new Response('boom', { status: 500 })],
  ])('answers 500 on %s', async (_name, answer) => {
    await stubEnv({ answer });

    const response = await callCheck(OPS_AUTH);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
  });
});

import { describe, expect, it, vi } from 'vite-plus/test';
import { accessConfig } from '@flarewatch/config/access';
import { Route } from '@/routes/api/admin/ack';
import { authMiddlewareServer } from '@/server/auth-middleware';
import { buildAuthSecret } from '../helpers/auth-secret';
import { memoryKv } from '../helpers/kv';
import { restoreAfterEach } from '../helpers/config';
import { stubMonitorWorker } from '../helpers/bindings';

restoreAfterEach(accessConfig, ['providers', 'operators', 'members']);
type Handler = (ctx: { request: Request }) => Promise<Response>;
const options = Route.options as { server?: { handlers?: Record<string, Handler> } };
function send(body: unknown, headers?: HeadersInit) {
  const request = new Request('https://status.test/api/admin/ack', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
  return authMiddlewareServer({
    request,
    pathname: '/api/admin/ack',
    next: async () => {
      const handler = options.server?.handlers?.POST;
      if (!handler) throw new Error('Missing ack handler');
      return handler({ request });
    },
  } as never) as Promise<Response>;
}

describe('acknowledgement route', () => {
  it('refuses anonymous visitors and signed-in members', async () => {
    vi.stubEnv('DEV', false);
    accessConfig.providers = [
      { id: 'id', name: 'Sign in', issuer: 'https://id.test', clientId: 'fw' },
    ];
    accessConfig.members = ['member@example.com'];
    vi.stubGlobal('__env__', {
      FLAREWATCH_STATE: memoryKv({
        'admin_session:member': JSON.stringify({
          createdAt: 1,
          ip: null,
          identity: {
            kind: 'provider',
            provider: 'id',
            name: 'Member',
            email: 'member@example.com',
            emailVerified: true,
            groups: [],
          },
        }),
      }),
    });
    expect((await send({ id: 'api' })).status).toBe(401);
    expect((await send({ id: 'api' }, { Cookie: 'flarewatch_admin_session=member' })).status).toBe(
      401,
    );
  });
  it('uses the operator name, ignores a forged responder and preserves hub refusal', async () => {
    vi.stubEnv('DEV', false);
    accessConfig.providers = [
      { id: 'id', name: 'Sign in', issuer: 'https://id.test', clientId: 'fw' },
    ];
    accessConfig.operators = ['op@example.com'];
    const bodies: unknown[] = [];
    stubMonitorWorker(async (_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
      bodies.push(JSON.parse(init.body));
      return new Response(null, { status: bodies.length === 1 ? 204 : 409 });
    });
    const env = globalThis.__env__;
    vi.stubGlobal('__env__', {
      ...env,
      FLAREWATCH_STATE: memoryKv({
        'admin_session:op': JSON.stringify({
          createdAt: 1,
          ip: null,
          identity: {
            kind: 'provider',
            provider: 'id',
            name: 'Pat',
            email: 'op@example.com',
            emailVerified: true,
            groups: [],
          },
        }),
      }),
    });
    const headers = { Cookie: 'flarewatch_admin_session=op' };
    expect((await send({ id: 'api', by: 'forged' }, headers)).status).toBe(204);
    expect(bodies).toEqual([{ by: 'Pat' }]);
    expect((await send({ id: 'api' }, headers)).status).toBe(409);
    expect((await send({}, headers)).status).toBe(400);
  });
  it('uses operator for password calls and shares the Basic authentication limiter', async () => {
    vi.stubEnv('DEV', false);
    const bodies: unknown[] = [];
    stubMonitorWorker(async (_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
      bodies.push(JSON.parse(init.body));
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('__env__', {
      ...globalThis.__env__,
      FLAREWATCH_ADMIN_BASIC_AUTH: await buildAuthSecret('ops', 'secret'),
      LOGIN_RATE_LIMIT: { limit: async () => ({ success: true }) },
    });
    const headers = { Authorization: `Basic ${btoa('ops:secret')}` };
    expect((await send({ id: 'api' }, headers)).status).toBe(204);
    expect(bodies).toEqual([{ by: 'operator' }]);
    vi.stubGlobal('__env__', {
      ...globalThis.__env__,
      LOGIN_RATE_LIMIT: { limit: async () => ({ success: false }) },
    });
    expect((await send({ id: 'api' }, headers)).status).toBe(429);
    expect((await send({ id: 'api' }, { ...headers, Origin: 'https://foreign.test' })).status).toBe(
      403,
    );
  });
});

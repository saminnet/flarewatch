import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { isValidAnnouncement, type Announcement } from '@flarewatch/shared';
import { Route } from '@/routes/api/admin/announcements';
import { authMiddlewareServer } from '@/server/auth-middleware';
import { forgetCachedView, readVisitorSnapshot } from '@/lib/snapshots';
import { buildAuthSecret } from '../helpers/auth-secret';

const current: Announcement = {
  id: 'ann_1',
  title: 'Update',
  body: 'Details',
  end: '2026-12-01T00:00:00.000Z',
  createdAt: 1,
  updatedAt: 1,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  forgetCachedView();
});

type Handler = (ctx: { request: Request }) => Promise<Response>;
function send(method: string, body?: unknown) {
  const options = Route.options as { server?: { handlers?: Record<string, Handler> } };
  const handler = options.server?.handlers?.[method];
  if (!handler) throw new Error(`Missing announcement ${method}`);
  return handler({
    request: new Request('https://status.test/api/admin/announcements', {
      method,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
  });
}

function stubHub(initial: Announcement[] = [current]) {
  let announcements = initial;
  vi.stubGlobal('__env__', {
    MONITOR_WORKER: {
      fetch: async (url: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          if (typeof init.body !== 'string') throw new Error('Expected JSON text');
          const value: unknown = JSON.parse(init.body);
          if (!isValidAnnouncement(value)) throw new Error('Expected announcement');
          announcements = [value, ...announcements.filter((a) => a.id !== value.id)];
          return new Response(null, { status: 204 });
        }
        if (init?.method === 'DELETE') {
          const id = decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '');
          const found = announcements.some((a) => a.id === id);
          announcements = announcements.filter((a) => a.id !== id);
          return new Response(null, { status: found ? 204 : 404 });
        }
        return Response.json(
          url.endsWith('/view')
            ? { lastUpdate: 100, monitors: {}, maintenances: [], announcements }
            : announcements,
        );
      },
    },
  });
}

describe('/api/admin/announcements', () => {
  it('creates normalized announcements and invalidates the visitor snapshot', async () => {
    stubHub([]);
    expect((await readVisitorSnapshot()).announcements).toEqual([]);
    const created = await send('POST', {
      title: '  Update ',
      body: '  Details ',
      end: '2026-06-10T12:00:00+02:00',
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      title: 'Update',
      body: 'Details',
      end: '2026-06-10T10:00:00.000Z',
    });
    expect((await readVisitorSnapshot()).announcements).toEqual([
      expect.objectContaining({ title: 'Update', body: 'Details' }),
    ]);
  });

  it('names invalid fields and enforces required text and size limits', async () => {
    stubHub([]);
    for (const [patch, field] of [
      [{ title: 123 }, 'Title'],
      [{ title: '' }, 'Title'],
      [{ title: null }, 'Title'],
      [{ body: [] }, 'Body'],
      [{ body: ' ' }, 'Body'],
      [{ end: true }, 'End'],
      [{ end: 'invalid' }, 'End'],
      [{ title: 'x'.repeat(201) }, 'Title'],
      [{ body: 'x'.repeat(2001) }, 'Body'],
    ] as const) {
      const response = await send('POST', { title: 'Update', body: 'Details', ...patch });
      expect(response.status).toBe(400);
      expect(await response.json()).toHaveProperty('error', expect.stringContaining(field));
    }
    expect((await send('POST', { title: 'x'.repeat(200), body: 'x'.repeat(2000) })).status).toBe(
      201,
    );
  });

  it('updates text, clears the end, preserves identity and deletes only once', async () => {
    stubHub();
    const updated = await send('PUT', {
      id: current.id,
      updates: { body: '  Changed  ', end: null, id: 'forged', createdAt: 9 },
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      id: current.id,
      createdAt: 1,
      title: 'Update',
      body: 'Changed',
    });
    const listed = await send('GET');
    const announcements: unknown = await listed.json();
    if (!Array.isArray(announcements)) throw new Error('Expected announcement list');
    expect(announcements).toHaveLength(1);
    expect(announcements[0]).not.toHaveProperty('end');
    const bad = await send('PUT', { id: current.id, updates: { title: false } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toHaveProperty('error', expect.stringContaining('Title'));
    expect((await send('DELETE', { id: current.id })).status).toBe(204);
    expect((await send('DELETE', { id: current.id })).status).toBe(404);
    expect((await send('PUT', { id: current.id, updates: {} })).status).toBe(404);
    expect((await send('PUT', { updates: {} })).status).toBe(400);
  });

  it('returns hub refusals and contains failures', async () => {
    vi.stubGlobal('__env__', {
      MONITOR_WORKER: {
        fetch: async () => Response.json({ error: 'Too many announcements' }, { status: 400 }),
      },
    });
    const refused = await send('POST', { title: 'Update', body: 'Details' });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'Too many announcements' });
    vi.stubGlobal('__env__', {});
    expect((await send('GET')).status).toBe(500);
    expect((await send('POST', { title: 'Update', body: 'Details' })).status).toBe(500);
    expect((await send('DELETE', { id: current.id })).status).toBe(500);
  });

  it('uses the maintenance authentication and rejects foreign writes', async () => {
    vi.stubEnv('DEV', false);
    vi.stubGlobal('__env__', {
      FLAREWATCH_ADMIN_BASIC_AUTH: await buildAuthSecret('ops', 'secret'),
      LOGIN_RATE_LIMIT: { limit: async () => ({ success: true }) },
    });
    const call = (headers: HeadersInit) =>
      authMiddlewareServer({
        request: new Request('https://status.test/api/admin/announcements', {
          method: 'POST',
          headers,
        }),
        pathname: '/api/admin/announcements',
        next: async () => new Response('authorized'),
      } as never) as Promise<Response>;
    expect((await call({})).status).toBe(401);
    expect(await (await call({ Authorization: `Basic ${btoa('ops:secret')}` })).text()).toBe(
      'authorized',
    );
    expect((await call({ Authorization: `Basic ${btoa('ops:wrong')}` })).status).toBe(401);
    expect(
      (await call({ Authorization: `Basic ${btoa('ops:secret')}`, Origin: 'https://foreign.test' }))
        .status,
    ).toBe(403);
  });
});

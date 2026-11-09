import { describe, expect, it, vi } from 'vite-plus/test';
import { isValidAnnouncement, type Announcement } from '@flarewatch/shared';
import { Route } from '@/routes/api/admin/announcements';
import { authMiddlewareServer } from '@/server/auth-middleware';
import { isJsonObject, normalizeAnnouncement } from '@flarewatch/shared';
import { readVisitorSnapshot } from '@/lib/hub-cache';
import { buildAuthSecret } from '../helpers/auth-secret';
import { stubMonitorWorker } from '../helpers/bindings';
import { forgetViewAroundEachTest } from '../helpers/snapshots';

const current: Announcement = {
  id: 'ann_1',
  title: 'Update',
  body: 'Details',
  end: '2026-12-01T00:00:00.000Z',
  createdAt: 1,
  updatedAt: 1,
};
forgetViewAroundEachTest();

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
  stubMonitorWorker(async (url, init) => {
    if (init?.method === 'POST' && url.endsWith('/updates')) {
      if (typeof init.body !== 'string') throw new Error('Expected JSON text');
      const update: unknown = JSON.parse(init.body);
      if (!isJsonObject(update)) throw new Error('Expected update');
      const id = decodeURIComponent(new URL(url).pathname.split('/').at(-2) ?? '');
      const current = announcements.find((a) => a.id === id);
      if (!current) return Response.json({ error: 'Announcement not found' }, { status: 404 });
      const result = normalizeAnnouncement({
        ...current,
        updates: [...(current.updates ?? []), { ...update, at: new Date().toISOString() }],
      });
      if ('error' in result) return Response.json(result, { status: 400 });
      const saved = { ...current, ...result.value };
      announcements = [saved, ...announcements.filter((a) => a.id !== id)];
      return Response.json(saved);
    }
    if (init?.method === 'PUT') {
      if (typeof init.body !== 'string') throw new Error('Expected JSON text');
      const value: unknown = JSON.parse(init.body);
      if (!isValidAnnouncement(value)) throw new Error('Expected announcement');
      const previous = announcements.find((a) => a.id === value.id);
      const saved =
        previous?.kind === 'incident'
          ? {
              ...value,
              updates: previous.updates ?? [],
              status: previous.updates?.at(-1)?.status ?? value.status,
            }
          : value;
      announcements = [saved, ...announcements.filter((a) => a.id !== value.id)];
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
    stubMonitorWorker(async () =>
      Response.json({ error: 'Too many announcements' }, { status: 400 }),
    );
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

it('forwards only the attributed update through the Fetcher seam', async () => {
  const requests: unknown[] = [];
  const incident: Announcement = {
    ...current,
    kind: 'incident',
    status: 'monitoring',
    updates: Array.from({ length: 11 }, () => ({
      at: '2026-01-01T00:00:00.000Z',
      status: 'monitoring',
      body: '界'.repeat(2000),
      by: 'Pat',
    })),
  };
  stubMonitorWorker(async (url, init) => {
    if (!init?.method) return Response.json([incident]);
    if (typeof init?.body !== 'string') throw new Error('Expected JSON text');
    const body: unknown = JSON.parse(init.body);
    requests.push({ url, method: init.method, body });
    return Response.json({ ...current, kind: 'incident', status: 'identified', updates: [] });
  });
  expect(
    (
      await send('PUT', {
        id: current.id,
        updates: {
          addUpdate: { status: 'identified', body: 'Cause found.', by: 'forged', at: 'forged' },
        },
      })
    ).status,
  ).toBe(200);
  const expected = {
    url: 'https://internal/announcements/ann_1/updates',
    method: 'POST',
    body: { status: 'identified', body: 'Cause found.', by: 'operator' },
  };
  expect(requests).toEqual([expected]);
  expect(
    (
      await send('PUT', {
        id: current.id,
        updates: {
          title: current.title,
          body: current.body,
          end: current.end,
          kind: 'incident',
          status: 'identified',
          addUpdate: { status: 'identified', body: 'Cause found.' },
        },
      })
    ).status,
  ).toBe(200);
  expect(requests).toEqual([expected, expected]);
});

it('preserves append refusals from the hub', async () => {
  for (const status of [400, 404, 409]) {
    stubMonitorWorker(async () => Response.json({ error: 'Refused update' }, { status }));
    const response = await send('PUT', {
      id: current.id,
      updates: {
        addUpdate: { status: 'identified', body: 'Cause found.' },
      },
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'Refused update' });
  }
});

it('allows retained stale monitors on edits but refuses newly supplied unknown ids', async () => {
  stubHub([{ ...current, kind: 'incident', monitors: ['retired-api'] }]);
  const response = await send('PUT', { id: current.id, updates: { body: 'New text', end: null } });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ body: 'New text', monitors: ['retired-api'] });
  expect(
    (await send('PUT', { id: current.id, updates: { monitors: ['retired-api', 'unknown'] } }))
      .status,
  ).toBe(400);
  expect((await send('PUT', { id: current.id, updates: { monitors: [] } })).status).toBe(200);
  expect(
    (await send('PUT', { id: current.id, updates: { monitors: ['retired-api'] } })).status,
  ).toBe(400);
});

it('creates scoped manual incidents, validates config ids and appends attributed updates without replacing history', async () => {
  stubHub([]);
  const { workerConfig } = await import('@flarewatch/config/worker');
  const id = workerConfig.monitors[0]?.id;
  if (!id) throw new Error('Expected configured monitor');
  expect(
    (
      await send('POST', {
        title: 'API delays',
        body: 'Investigating.',
        kind: 'incident',
        monitors: ['missing-id'],
      })
    ).status,
  ).toBe(400);
  const created = await send('POST', {
    title: 'API delays',
    body: 'Investigating.',
    kind: 'incident',
    monitors: [id],
    status: 'investigating',
  });
  expect(created.status).toBe(201);
  const announcement: unknown = await created.json();
  if (!isValidAnnouncement(announcement)) throw new Error('Expected incident');
  expect(
    (
      await send('PUT', {
        id: announcement.id,
        updates: {
          title: 'Must not save',
          addUpdate: { status: 'identified', body: ' ' },
        },
      })
    ).status,
  ).toBe(400);
  expect(await (await send('GET')).json()).toEqual([
    expect.objectContaining({ title: 'API delays' }),
  ]);
  const updated = await send('PUT', {
    id: announcement.id,
    updates: {
      addUpdate: {
        status: 'identified',
        body: 'Cause found.',
        by: 'forged',
        at: '1970-01-01T00:00:00Z',
      },
    },
  });
  expect(updated.status).toBe(200);
  const result: unknown = await updated.json();
  if (!isValidAnnouncement(result)) throw new Error('Expected incident');
  expect(result.status).toBe('identified');
  expect(result.updates).toHaveLength(1);
  expect(result.updates?.[0]?.by).toBe('operator');
  expect(result.updates?.[0]?.at).not.toBe('1970-01-01T00:00:00.000Z');
  expect(
    (await send('PUT', { id: announcement.id, updates: { updates: [], body: 'Still working.' } }))
      .status,
  ).toBe(200);
  const listed: unknown = await (await send('GET')).json();
  expect(listed).toEqual([expect.objectContaining({ updates: result.updates })]);
  expect(
    (
      await send('PUT', {
        id: announcement.id,
        updates: { addUpdate: { status: 'broken', body: 'Oops' } },
      })
    ).status,
  ).toBe(400);
  const combined = await send('PUT', {
    id: announcement.id,
    updates: {
      title: 'Recovery',
      addUpdate: { status: 'monitoring', body: 'Watching recovery.' },
    },
  });
  expect(combined.status).toBe(200);
  expect(await combined.json()).toMatchObject({
    title: 'Recovery',
    status: 'monitoring',
    updates: [
      expect.objectContaining({ body: 'Cause found.' }),
      expect.objectContaining({ body: 'Watching recovery.' }),
    ],
  });
  expect(await (await send('GET')).json()).toEqual([
    expect.objectContaining({
      title: 'Recovery',
      updates: [
        expect.objectContaining({ body: 'Cause found.' }),
        expect.objectContaining({ body: 'Watching recovery.' }),
      ],
    }),
  ]);
});

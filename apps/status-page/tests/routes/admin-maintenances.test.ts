import { describe, expect, it, afterEach, vi } from 'vite-plus/test';
import type { Maintenance } from '@flarewatch/shared';
import { normalizeMaintenanceUpdates, Route } from '@/routes/api/admin/maintenances';

const originalEnv = globalThis.__env__;

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.__env__ = originalEnv;
});

function getHandler(method: 'POST' | 'PUT') {
  const options = Route.options as { server?: { handlers?: Record<string, Handler> } };
  const handler = options.server?.handlers?.[method];
  if (!handler) throw new Error(`${method} handler not found on the maintenances route`);
  return handler;
}

const getPostHandler = () => getHandler('POST');

type Handler = (ctx: { request: Request }) => Promise<Response>;

const current: Maintenance = {
  id: 'maint_1',
  title: 'Upgrade',
  body: 'Database upgrade',
  start: '2026-01-01T00:00:00.000Z',
  end: '2026-01-01T02:00:00.000Z',
  monitors: ['api'],
  color: 'amber',
  createdAt: 0,
  updatedAt: 0,
};

describe('normalizeMaintenanceUpdates', () => {
  it('clears nullable fields sent as null', () => {
    expect(
      normalizeMaintenanceUpdates({ title: null, color: null, monitors: null, end: null }, current),
    ).toStrictEqual({ title: undefined, color: undefined, monitors: undefined, end: undefined });
  });

  it('leaves fields that are absent from the update untouched', () => {
    expect(normalizeMaintenanceUpdates({}, current)).toStrictEqual({});
  });

  it('rejects an empty body', () => {
    expect(normalizeMaintenanceUpdates({ body: '' }, current)).toBeNull();
  });

  it('rejects an end before the start', () => {
    expect(normalizeMaintenanceUpdates({ end: '2025-12-31T00:00:00.000Z' }, current)).toBeNull();
  });

  it('checks ordering against the epoch as an end', () => {
    expect(normalizeMaintenanceUpdates({ end: 0 }, current)).toBeNull();
  });

  it('rejects monitors that are not all ids instead of widening to every monitor', () => {
    expect(normalizeMaintenanceUpdates({ monitors: [123] }, current)).toBeNull();
    expect(normalizeMaintenanceUpdates({ monitors: ['api', ''] }, current)).toBeNull();
    expect(normalizeMaintenanceUpdates({ monitors: [] }, current)).toStrictEqual({
      monitors: undefined,
    });
  });
});

describe('normalizeMaintenanceUpdates with a repeat', () => {
  const series: Maintenance = { ...current, repeat: { every: 'day' } };

  it('sets, keeps and clears the rule', () => {
    expect(
      normalizeMaintenanceUpdates({ repeat: { every: 'week', weekdays: [3, 1] } }, current),
    ).toStrictEqual({
      repeat: { every: 'week', weekdays: [1, 3] },
    });
    expect(normalizeMaintenanceUpdates({ repeat: null }, series)).toStrictEqual({
      repeat: undefined,
    });
  });

  it('checks a changed time against the rule it keeps', () => {
    expect(normalizeMaintenanceUpdates({ end: '2026-01-02T00:00:01.000Z' }, series)).toBeNull();
    expect(normalizeMaintenanceUpdates({ end: null }, series)).toBeNull();
  });
});

describe('POST /api/admin/maintenances', () => {
  function postRequest(body: unknown): Request {
    return new Request('https://flarewatch.test/api/admin/maintenances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('saves the window trimmed, with ISO times, deduped monitors and nulls left out', async () => {
    const saved: unknown[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      saved.push(typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body);
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('__env__', { MONITOR_WORKER: { fetch } });

    const response = await getPostHandler()({
      request: postRequest({
        body: '  Upgrade ',
        title: null,
        start: '2026-06-10T12:00:00+02:00',
        end: null,
        monitors: ['api', 'api'],
      }),
    });

    expect(response.status).toBe(201);
    expect(saved).toEqual([
      expect.objectContaining({
        body: 'Upgrade',
        start: '2026-06-10T10:00:00.000Z',
        monitors: ['api'],
      }),
    ]);
    expect(saved[0]).not.toHaveProperty('end');
    expect(saved[0]).not.toHaveProperty('title');
  });

  it('names the reason when it rejects a window', async () => {
    const response = await getPostHandler()({
      request: postRequest({
        body: 'Maintenance',
        start: '2026-01-01T02:00:00Z',
        end: '2026-01-01T01:00:00Z',
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invalid maintenance payload: End must not be before start',
    });
  });

  it('saves a repeat rule and names the reason when it rejects one', async () => {
    const saved: unknown[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      saved.push(typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body);
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('__env__', { MONITOR_WORKER: { fetch } });
    const window = { body: 'Backups', start: '2026-06-01T01:00:00Z', end: '2026-06-01T02:00:00Z' };

    const created = await getPostHandler()({
      request: postRequest({
        ...window,
        repeat: { every: 'month', dayOfMonth: 31, timeZone: 'Europe/Berlin' },
      }),
    });
    const noEnd = await getPostHandler()({
      request: postRequest({ body: 'Backups', start: window.start, repeat: { every: 'day' } }),
    });

    expect(created.status).toBe(201);
    expect(saved).toEqual([
      expect.objectContaining({
        repeat: { every: 'month', dayOfMonth: 31, timeZone: 'Europe/Berlin' },
      }),
    ]);
    expect(noEnd.status).toBe(400);
    expect(await noEnd.json()).toEqual({
      error: 'Invalid maintenance payload: A repeating window needs an end',
    });
  });

  it('rejects invalid dates with 400 without writing', async () => {
    const put = vi.fn(async () => {});
    const kv = { get: vi.fn(async () => null), put };
    globalThis.__env__ = { FLAREWATCH_STATE: kv as typeof kv & KVNamespace };

    for (const start of ['not-a-date', null]) {
      const response = await getPostHandler()({
        request: postRequest({ body: 'Maintenance', start }),
      });
      expect(response.status).toBe(400);
    }
    const badEnd = await getPostHandler()({
      request: postRequest({ body: 'Maintenance', start: '2026-01-01T00:00:00Z', end: 'nope' }),
    });
    expect(badEnd.status).toBe(400);

    expect(put).not.toHaveBeenCalled();
  });

  it('rejects monitors that are not all ids with 400 without writing', async () => {
    const put = vi.fn(async () => {});
    const kv = { get: vi.fn(async () => null), put };
    globalThis.__env__ = { FLAREWATCH_STATE: kv as typeof kv & KVNamespace };

    const response = await getPostHandler()({
      request: postRequest({ body: 'Maintenance', start: '2026-01-01T00:00:00Z', monitors: [1] }),
    });

    expect(response.status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });

  it('rejects a body over 64 KiB with 400 without writing', async () => {
    const put = vi.fn(async () => {});
    const kv = { get: vi.fn(async () => null), put };
    globalThis.__env__ = { FLAREWATCH_STATE: kv as typeof kv & KVNamespace };

    const response = await getPostHandler()({
      request: postRequest({ body: 'x'.repeat(65 * 1024), start: '2026-01-01T00:00:00Z' }),
    });

    expect(response.status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });
});

describe('the hub refusing a window', () => {
  function stubHub() {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? Response.json({ error: 'Too many maintenance windows' }, { status: 400 })
        : Response.json([current]),
    );
    vi.stubGlobal('__env__', { MONITOR_WORKER: { fetch } });
  }

  const send = (method: 'POST' | 'PUT', body: unknown) =>
    getHandler(method)({
      request: new Request('https://flarewatch.test/api/admin/maintenances', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });

  it.each([
    ['POST', { body: 'Upgrade', start: '2026-06-10T10:00:00Z' }],
    ['PUT', { id: current.id, updates: { body: 'Edited' } }],
  ] as const)('answers %s with 400 and the reason the hub gave', async (method, body) => {
    stubHub();

    const response = await send(method, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Too many maintenance windows' });
  });
});

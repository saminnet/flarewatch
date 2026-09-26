import { describe, expect, it, afterEach, vi } from 'vite-plus/test';
import type { Maintenance } from '@flarewatch/shared';
import { normalizeMaintenanceUpdates, Route } from '@/routes/api/admin/maintenances';

const originalEnv = globalThis.__env__;

afterEach(() => {
  globalThis.__env__ = originalEnv;
});

function getPostHandler() {
  const options = Route.options as { server?: { handlers?: Record<string, Handler> } };
  const post = options.server?.handlers?.POST;
  if (!post) throw new Error('POST handler not found on the maintenances route');
  return post;
}

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
});

describe('POST /api/admin/maintenances', () => {
  function postRequest(body: unknown): Request {
    return new Request('https://flarewatch.test/api/admin/maintenances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('rejects invalid dates with 400 without writing', async () => {
    const put = vi.fn(async () => {});
    const kv = { get: vi.fn(async () => null), put };
    globalThis.__env__ = { STATE_KV: kv as typeof kv & KVNamespace };

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
});

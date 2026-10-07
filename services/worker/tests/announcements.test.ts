import { describe, expect, it } from 'vite-plus/test';
import type { Announcement } from '@flarewatch/shared';
import { handleHubRequest } from '../src/hub/routes';
import { createHub, hubNamespace } from './helpers/hub';

const announcement = (id: string, createdAt = 1): Announcement => ({
  id,
  title: 'Update',
  body: 'Details',
  createdAt,
  updatedAt: createdAt,
});
function fixture() {
  const { hub, db } = createHub();
  const env = { MONITOR_HUB: hubNamespace(hub) };
  return {
    hub,
    db,
    send: (path: string, method = 'GET', body?: unknown) =>
      handleHubRequest(
        new Request(`https://internal${path}`, {
          method,
          ...(body !== undefined && { body: JSON.stringify(body) }),
        }),
        env,
      ),
  };
}

describe('announcement hub routes', () => {
  it('stores normalized records and reads newest first with maintenance in one view after restart', async () => {
    const { hub, db, send } = fixture();
    hub.record(100, [
      {
        monitor: { id: 'api', name: 'API', method: 'GET', target: 'https://api.test' },
        check: { location: 'HEL', result: { ok: false, error: 'Down' } },
      },
    ]);
    const before = hub.view().monitors;
    hub.putMaintenance({
      id: 'm',
      body: 'Work',
      start: '2026-01-01T00:00:00.000Z',
      createdAt: 1,
      updatedAt: 1,
    });
    expect((await send('/announcements/old', 'PUT', announcement('old')))?.status).toBe(204);
    expect(
      (
        await send('/announcements/new', 'PUT', {
          ...announcement('new', 2),
          title: ' Update ',
          body: ' Details ',
          end: '2026-06-10T12:00:00+02:00',
          ignored: true,
        })
      )?.status,
    ).toBe(204);
    const expected = [
      { ...announcement('new', 2), end: '2026-06-10T10:00:00.000Z' },
      announcement('old'),
    ];
    expect(await (await send('/announcements'))?.json()).toEqual(expected);
    const restarted = createHub({}, db).hub.view();
    expect(restarted.announcements).toEqual(expected);
    expect(restarted.maintenances).toHaveLength(1);
    expect(restarted.monitors).toEqual(before);
    expect(await (await send('/view'))?.json()).toMatchObject({
      announcements: expected,
      maintenances: [expect.objectContaining({ id: 'm' })],
    });
  });

  it('caps storage at 50 while allowing edits and deletes', async () => {
    const { hub, send } = fixture();
    for (let i = 0; i < 50; i++) expect(hub.putAnnouncement(announcement(`a${i}`))).toBe(true);
    const full = await send('/announcements/new', 'PUT', announcement('new'));
    expect(full?.status).toBe(400);
    expect(await full?.json()).toEqual({ error: 'Too many announcements' });
    expect(
      (await send('/announcements/a1', 'PUT', { ...announcement('a1'), body: 'Changed' }))?.status,
    ).toBe(204);
    expect(hub.view().announcements.find((a) => a.id === 'a1')?.body).toBe('Changed');
    expect((await send('/announcements/a1', 'DELETE'))?.status).toBe(204);
    expect((await send('/announcements/a1', 'DELETE'))?.status).toBe(404);
    expect((await send('/announcements/new', 'PUT', announcement('new')))?.status).toBe(204);
    expect(hub.view().announcements).toHaveLength(50);
  });

  it('rejects malformed ids, mismatched records, oversized requests and invalid fields', async () => {
    const { hub, send } = fixture();
    expect((await send('/announcements/%ZZ', 'PUT', {}))?.status).toBe(400);
    expect((await send('/announcements/%ZZ', 'DELETE'))?.status).toBe(400);
    expect((await send('/announcements/other', 'PUT', announcement('a')))?.status).toBe(400);
    for (const patch of [
      { title: true },
      { body: 1 },
      { end: {} },
      { title: 'x'.repeat(201) },
      { body: 'x'.repeat(2001) },
      { padding: 'x'.repeat(64 * 1024) },
    ]) {
      expect(
        (await send('/announcements/a', 'PUT', { ...announcement('a'), ...patch }))?.status,
      ).toBe(400);
    }
    expect(hub.view().announcements).toEqual([]);
  });
});

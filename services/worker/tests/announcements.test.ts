import { describe, expect, it } from 'vite-plus/test';
import type { Announcement } from '@flarewatch/shared';
import { handleHubRequest } from '../src/hub/routes';
import { createHub, hubNamespace } from './helpers/hub';

const announcement = (id: string, createdAt = 1): Announcement => ({
  id,
  title: 'Update',
  body: 'Details',
  kind: 'notice',
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
  it('appends concurrent updates in order and rejects the twenty-first update', async () => {
    const { hub, send } = fixture();
    hub.putAnnouncement({ ...announcement('incident'), kind: 'incident' });
    const append = (body: string) =>
      send('/announcements/incident/updates', 'POST', {
        status: 'identified',
        body,
        by: 'Pat',
        at: '1970-01-01T00:00:00Z',
      });
    const results = await Promise.all([append('First'), append('Second')]);
    expect(results.map((r) => r?.status)).toEqual([200, 200]);
    expect(hub.announcements()[0]?.updates?.map((u) => u.body)).toEqual(['First', 'Second']);
    expect(
      (
        await send('/announcements/incident', 'PUT', {
          ...announcement('incident'),
          kind: 'incident',
          title: 'Changed title',
          updates: [],
        })
      )?.status,
    ).toBe(204);
    expect(hub.announcements()[0]?.updates?.map((u) => u.body)).toEqual(['First', 'Second']);
    expect(hub.announcements()[0]?.updates?.[0]?.at).not.toBe('1970-01-01T00:00:00.000Z');
    for (let i = 2; i < 20; i++) expect((await append(`Update ${i}`))?.status).toBe(200);
    expect((await append('Overflow'))?.status).toBe(409);
    expect(hub.announcements()[0]?.updates).toHaveLength(20);
  });

  it('accepts eleven CJK updates without forwarding accumulated history', async () => {
    const { hub, send } = fixture();
    hub.putAnnouncement({ ...announcement('cjk'), kind: 'incident' });
    for (let i = 0; i < 11; i++) {
      expect(
        (
          await send('/announcements/cjk/updates', 'POST', {
            status: 'monitoring',
            body: '界'.repeat(2000),
            by: 'Pat',
          })
        )?.status,
      ).toBe(200);
    }
    expect(hub.announcements()[0]?.updates).toHaveLength(11);
  });

  it('refuses invalid append fields, unknown ids, oversized patches and oversized rows without changing history', async () => {
    const { hub, send } = fixture();
    hub.putAnnouncement({ ...announcement('incident'), kind: 'incident' });
    const valid = { status: 'identified', body: 'Found it', by: 'Pat' };
    expect((await send('/announcements/missing/updates', 'POST', valid))?.status).toBe(404);
    expect((await send('/announcements/%ZZ/updates', 'POST', valid))?.status).toBe(400);
    for (const patch of [
      null,
      { ...valid, body: 'x'.repeat(2001) },
      { ...valid, body: ' ' },
      { ...valid, by: ' ' },
      { ...valid, status: 'invalid' },
      { ...valid, padding: 'x'.repeat(16 * 1024) },
    ]) {
      expect((await send('/announcements/incident/updates', 'POST', patch))?.status).toBe(400);
    }
    expect(hub.announcements()[0]?.updates).toBeUndefined();
    hub.putAnnouncement({
      ...announcement('huge'),
      kind: 'incident',
      monitors: ['界'.repeat(640_000)],
    });
    const response = await send('/announcements/huge/updates', 'POST', valid);
    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({ error: 'Announcement exceeds the row size limit' });
    hub.putAnnouncement(announcement('notice'));
    expect((await send('/announcements/notice/updates', 'POST', valid))?.status).toBe(400);
  });

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
    const restarted = createHub(db).hub.view();
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
      { id: undefined },
      { createdAt: 'yesterday' },
      { updatedAt: null },
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

  it('drops malformed stored rows and serves uncapped legacy records', async () => {
    const { hub, db, send } = fixture();
    const legacy = { ...announcement('legacy', 2), body: 'x'.repeat(3000) };
    hub.putAnnouncement(legacy);
    const insert = (id: string, data: unknown) =>
      db
        .prepare('INSERT INTO announcements (id, data) VALUES (?, ?)')
        .run(id, JSON.stringify(data));
    db.prepare("INSERT INTO announcements (id, data) VALUES ('garbage', 'not json')").run();
    insert('no-id', { title: 'Title', body: 'Body', createdAt: 1, updatedAt: 1 });
    insert('bad-time', { ...announcement('bad-time'), createdAt: 'x' });

    expect(hub.view().announcements).toEqual([legacy]);
    expect(await (await send('/announcements'))?.json()).toEqual([legacy]);
    expect(createHub(db).hub.view().announcements).toEqual([legacy]);
    expect(
      (await send('/announcements/legacy', 'PUT', { ...legacy, body: 'y'.repeat(2001) }))?.status,
    ).toBe(400);
  });
});

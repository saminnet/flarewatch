import { describe, expect, it } from 'vite-plus/test';
import { DatabaseSync } from 'node:sqlite';
import oldState from '../fixtures/state-v1.json';
import { createHub } from '../helpers/hub';
import { asKv, createKv } from '../helpers/kv';

const T0 = oldState.lastUpdate;

async function importedHub(entries: Array<[string, unknown]>, db = new DatabaseSync(':memory:')) {
  const kv = createKv(entries);
  const created = createHub({ FLAREWATCH_STATE: asKv(kv) }, db);
  await created.ready();
  return { ...created, kv };
}

describe('1.x import', () => {
  it('copies incidents, start times, latency and the last update from the state blob', async () => {
    const { hub } = await importedHub([['state', JSON.stringify(oldState)]]);

    const { lastUpdate, monitors } = hub.view();
    expect(lastUpdate).toBe(T0);
    expect(monitors.legacy).toEqual({
      status: 'up',
      startedAt: oldState.startedAt.legacy,
      incidents: oldState.incident.legacy,
      latest: { ping: 42, loc: 'HEL', time: 1736942300 },
    });
    expect(hub.latency('legacy')).toEqual(oldState.latency.legacy.recent);
  });

  it('merges each job pings from KV with the status and misses the state blob held', async () => {
    const { hub } = await importedHub([
      [
        'state',
        JSON.stringify({
          ...oldState,
          heartbeat: {
            backup: { status: 'down', deadline: T0 - 60, misses: [T0 - 60], lastSuccess: T0 - 999 },
          },
        }),
      ],
      [
        'hb:v1:backup',
        JSON.stringify({ lastSuccess: T0 - 3660, runs: [{ at: T0 - 3660, outcome: 'ok' }] }),
      ],
      ['hb:v1:nightly', JSON.stringify({ lastFail: T0 - 5, message: 'disk full' })],
    ]);

    const { monitors } = hub.view();
    expect(monitors.backup?.heartbeat).toEqual({
      status: 'down',
      deadline: T0 - 60,
      misses: [T0 - 60],
      lastSuccess: T0 - 3660,
      runs: [{ at: T0 - 3660, outcome: 'ok' }],
    });
    expect(monitors.nightly?.heartbeat).toEqual({
      status: 'pending',
      lastFail: T0 - 5,
      message: 'disk full',
    });
  });

  it('imports every job when the pings span more than one page of KV keys', async () => {
    const jobs = Array.from({ length: 1001 }, (_, i) => `job${String(i).padStart(4, '0')}`);
    const { hub } = await importedHub(
      jobs.map((id): [string, unknown] => [`hb:v1:${id}`, JSON.stringify({ lastSuccess: T0 })]),
    );

    expect(Object.keys(hub.view().monitors)).toHaveLength(1001);
  });

  it('caps an incident with more segments than the hub keeps', async () => {
    const start = Array.from({ length: 1000 }, (_, i) => T0 - 1000 + i);
    const error = start.map((at) => `err-${at}`);
    const { hub } = await importedHub([
      [
        'state',
        JSON.stringify({
          ...oldState,
          startedAt: { flappy: T0 - 1000 },
          incident: { flappy: [{ start, error }] },
        }),
      ],
    ]);

    const [incident] = hub.view().monitors.flappy?.incidents ?? [];
    expect(incident?.start).toHaveLength(100);
    expect(incident?.error).toHaveLength(100);
    expect(incident?.start[0]).toBe(T0 - 1000);
  });

  it('copies the maintenance windows and drops invalid ones', async () => {
    const valid = {
      id: 'm1',
      body: 'Upgrade',
      start: '2025-01-15T10:00:00.000Z',
      createdAt: 1,
      updatedAt: 1,
    };
    const { hub } = await importedHub([['maintenances', JSON.stringify([valid, { id: 'bad' }])]]);

    expect(hub.view().maintenances).toEqual([valid]);
  });

  it('runs once, even when KV changes later', async () => {
    const db = new DatabaseSync(':memory:');
    await importedHub([['state', JSON.stringify(oldState)]], db);

    const again = await importedHub([['hb:v1:late', JSON.stringify({ lastSuccess: T0 })]], db);

    expect(again.kv.get).not.toHaveBeenCalled();
    expect(again.kv.put).not.toHaveBeenCalled();
    expect(again.hub.view().monitors.legacy?.incidents).toHaveLength(1);
    expect(again.hub.view().monitors.late).toBeUndefined();
  });

  it('marks KV as imported and leaves the 1.x keys as they were', async () => {
    const { kv } = await importedHub([['state', JSON.stringify(oldState)]]);

    expect(Number(kv.values.get('imported_to_hub'))).toBeGreaterThan(0);
    expect(kv.values.get('state')).toBe(JSON.stringify(oldState));
  });

  it('marks KV on a later start when the marker cannot be written', async () => {
    const db = new DatabaseSync(':memory:');
    const kv = createKv([['state', JSON.stringify(oldState)]]);
    kv.put.mockRejectedValueOnce(new Error('KV unavailable'));
    const first = createHub({ FLAREWATCH_STATE: asKv(kv) }, db);
    await first.ready();
    expect(first.hub.view().monitors.legacy?.incidents).toHaveLength(1);
    expect(kv.values.has('imported_to_hub')).toBe(false);

    const second = createHub({ FLAREWATCH_STATE: asKv(kv) }, db);
    await second.ready();

    expect(kv.values.has('imported_to_hub')).toBe(true);
  });

  it('leaves KV unmarked when the hub cannot save the import', async () => {
    const db = new DatabaseSync(':memory:');
    const kv = createKv([['state', JSON.stringify(oldState)]]);
    const first = createHub({ FLAREWATCH_STATE: asKv(kv) }, db);
    db.exec(
      "CREATE TRIGGER no_meta BEFORE INSERT ON meta BEGIN SELECT RAISE(ABORT, 'disk full'); END",
    );
    await expect(first.ready()).rejects.toThrow('disk full');
    expect(kv.values.has('imported_to_hub')).toBe(false);

    db.exec('DROP TRIGGER no_meta');
    const second = createHub({ FLAREWATCH_STATE: asKv(kv) }, db);
    await second.ready();

    expect(second.hub.view().monitors.legacy?.incidents).toHaveLength(1);
    expect(kv.values.has('imported_to_hub')).toBe(true);
  });

  it('retries on the next start when KV cannot be read', async () => {
    const db = new DatabaseSync(':memory:');
    const kv = createKv([['state', JSON.stringify(oldState)]]);
    kv.get.mockRejectedValueOnce(new Error('KV unavailable'));
    const first = createHub({ FLAREWATCH_STATE: asKv(kv) }, db);
    await first.ready();
    expect(first.hub.view().monitors).toEqual({});

    const { hub } = await importedHub([['state', JSON.stringify(oldState)]], db);

    expect(hub.view().monitors.legacy?.incidents).toHaveLength(1);
  });

  it('skips a state blob it cannot read and still imports the pings', async () => {
    const { hub } = await importedHub([
      ['state', JSON.stringify({ incident: 'garbage' })],
      ['hb:v1:backup', JSON.stringify({ lastSuccess: T0 })],
    ]);

    expect(hub.view()).toEqual({
      lastUpdate: 0,
      maintenances: [],
      monitors: {
        backup: {
          status: 'pending',
          incidents: [],
          heartbeat: { status: 'pending', lastSuccess: T0 },
        },
      },
    });
  });

  it('imports open incidents without ever alerting for them', async () => {
    const { hub } = await importedHub([
      [
        'state',
        JSON.stringify({
          ...oldState,
          incident: { legacy: [{ start: [T0 - 60], error: ['Timeout'] }] },
        }),
      ],
    ]);
    const monitor = {
      id: 'legacy',
      name: 'Legacy',
      method: 'GET' as const,
      target: 'https://legacy.example.com',
    };
    const policy = { gracePeriodSeconds: 0, skipIds: [], skipErrorChanges: false };

    const stillDown = hub.record(
      T0,
      [{ monitor, check: { location: 'HEL', result: { ok: false, error: 'HTTP 502' } } }],
      policy,
    );
    const recovered = hub.record(
      T0 + 60,
      [{ monitor, check: { location: 'HEL', result: { ok: true, latency: 1 } } }],
      policy,
    );

    expect([...stillDown.alerts, ...recovered.alerts]).toEqual([]);
  });
});

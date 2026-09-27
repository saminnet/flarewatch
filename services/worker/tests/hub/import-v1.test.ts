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
    expect(again.hub.view().monitors.legacy?.incidents).toHaveLength(1);
    expect(again.hub.view().monitors.late).toBeUndefined();
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
});

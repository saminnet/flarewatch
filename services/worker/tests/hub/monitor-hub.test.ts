import { describe, expect, it } from 'vite-plus/test';
import type { CheckResult, HeartbeatMonitor, MonitorTarget } from '@flarewatch/shared';
import type { CheckRecord } from '../../src/hub/monitor-hub';
import { createHub, rowsWritten } from '../helpers/hub';

const T0 = Date.parse('2025-01-15T12:00:00Z') / 1000;
const DAY = 24 * 60 * 60;

function monitor(id: string): MonitorTarget {
  return { id, name: id, method: 'GET', target: `https://${id}.example.com` };
}

function check(id: string, result: CheckResult, location = 'HEL'): CheckRecord {
  return { monitor: monitor(id), check: { location, result } };
}

const up = (latency = 10): CheckResult => ({ ok: true, latency });
const down = (error = 'Unavailable'): CheckResult => ({ ok: false, error });

describe('MonitorHub incidents', () => {
  it('opens an incident on the first failure and reports it as a down change', () => {
    const { hub } = createHub();

    const [update] = hub.record(T0, [check('api', down())]);

    expect(update).toEqual({
      monitorId: 'api',
      inMaintenance: false,
      statusChanged: true,
      changeType: 'down',
      isUp: false,
      incidentStartTime: T0,
      error: 'Unavailable',
    });
    expect(hub.view().monitors.api).toMatchObject({
      status: 'down',
      startedAt: T0,
      incidents: [{ start: [T0], error: ['Unavailable'] }],
    });
  });

  it('adds a segment only when the error changes, then closes on recovery', () => {
    const { hub } = createHub();
    hub.record(T0, [check('api', down('Timeout'))]);

    const [same] = hub.record(T0 + 60, [check('api', down('Timeout'))]);
    const [changed] = hub.record(T0 + 120, [check('api', down('HTTP 502'))]);
    const [recovered] = hub.record(T0 + 180, [check('api', up())]);

    expect(same).toMatchObject({ statusChanged: false, changeType: 'none', incidentStartTime: T0 });
    expect(changed).toMatchObject({
      statusChanged: true,
      changeType: 'error',
      incidentStartTime: T0,
    });
    expect(recovered).toMatchObject({
      statusChanged: true,
      changeType: 'up',
      incidentStartTime: T0,
    });
    expect(hub.view().monitors.api).toMatchObject({
      status: 'up',
      incidents: [{ start: [T0, T0 + 120], end: T0 + 180, error: ['Timeout', 'HTTP 502'] }],
    });
  });

  it('keeps the first and the latest segments of an incident whose error keeps changing', () => {
    const { hub } = createHub();
    for (let i = 0; i < 1000; i++) hub.record(T0 + i * 60, [check('api', down(`err-${i}`))]);

    const [incident] = hub.view().monitors.api?.incidents ?? [];
    expect(incident?.start).toHaveLength(100);
    expect(incident?.error).toHaveLength(100);
    expect(incident?.start[0]).toBe(T0);
    expect(incident?.error[0]).toBe('err-0');
    expect(incident?.start.slice(-1)).toEqual([T0 + 999 * 60]);
    expect(incident?.error.slice(-1)).toEqual(['err-999']);
    expect(incident?.error[1]).toBe('err-901');
  });

  it('keeps an open incident and drops closed ones 90 days after they end', () => {
    const { hub } = createHub();
    hub.record(T0, [check('old', down()), check('open', down())]);
    hub.record(T0 + 60, [check('old', up())]);

    hub.record(T0 + 60 + 90 * DAY + 1, [check('old', up()), check('open', down())]);

    const { monitors } = hub.view();
    expect(monitors.old?.incidents).toEqual([]);
    expect(monitors.open?.incidents).toHaveLength(1);
  });
});

describe('MonitorHub latency', () => {
  it('keeps one sample per check run for 12 hours', () => {
    const { hub } = createHub();
    hub.record(T0, [check('api', up(30))]);
    hub.record(T0 + 60, [check('api', up(40), 'AMS')]);
    hub.record(T0 + 12 * 60 * 60 + 30, [check('api', up(50))]);

    expect(hub.latency('api')).toEqual([
      { ping: 40, loc: 'AMS', time: T0 + 60 },
      { ping: 50, loc: 'HEL', time: T0 + 12 * 60 * 60 + 30 },
    ]);
    expect(hub.view().monitors.api?.latest).toEqual({
      ping: 50,
      loc: 'HEL',
      time: T0 + 12 * 60 * 60 + 30,
    });
  });

  it('returns only the asked monitor and handles ids that look like JSON paths', () => {
    const { hub } = createHub();
    hub.record(T0, [check('a.b', up(1)), check('$[0]', up(2)), check('x"y', up(3))]);

    expect(hub.latency('a.b')).toEqual([{ ping: 1, loc: 'HEL', time: T0 }]);
    expect(hub.latency('$[0]')).toEqual([{ ping: 2, loc: 'HEL', time: T0 }]);
    expect(hub.latency('x"y')).toEqual([{ ping: 3, loc: 'HEL', time: T0 }]);
  });
});

describe('MonitorHub heartbeat state', () => {
  const job: HeartbeatMonitor = {
    id: 'backup',
    name: 'Backup',
    method: 'HEARTBEAT',
    periodSeconds: 3600,
    graceSeconds: 600,
  };

  it('records one miss per skipped period while the job stays overdue', () => {
    const { hub } = createHub();
    hub.ping(job, 'success', T0 - 4200);
    const deadline = T0 - 4200 + 3600 + 600;

    hub.record(T0 + 60, [{ monitor: job }]);
    hub.record(T0 + 2 * 3600 + 60, [{ monitor: job }]);

    expect(hub.view().monitors.backup?.heartbeat?.misses).toEqual([
      deadline,
      deadline + 3600,
      deadline + 7200,
    ]);
  });

  it('shows a job that never pinged as pending, without a start time or incident', () => {
    const { hub } = createHub();

    const updates = hub.record(T0, [{ monitor: job }]);

    expect(updates).toEqual([]);
    expect(hub.view().monitors.backup).toEqual({
      status: 'pending',
      incidents: [],
      heartbeat: { status: 'pending' },
    });
  });

  it('keeps a ping and changes the status at the next check run', () => {
    const { hub } = createHub();
    hub.ping(job, 'fail', T0, 'disk full');
    hub.record(T0 + 1, [{ monitor: job }]);
    expect(hub.view().monitors.backup?.status).toBe('down');

    hub.ping(job, 'success', T0 + 30);
    expect(hub.view().monitors.backup).toMatchObject({
      status: 'down',
      heartbeat: {
        status: 'down',
        lastSuccess: T0 + 30,
        runs: [{ outcome: 'fail' }, { outcome: 'ok' }],
      },
    });

    const [update] = hub.record(T0 + 60, [{ monitor: job }]);
    expect(update).toMatchObject({ changeType: 'up', incidentStartTime: T0 + 1 });
    expect(hub.view().monitors.backup?.status).toBe('up');
    expect(hub.view().monitors.backup?.heartbeat).not.toHaveProperty('message');
  });
});

describe('MonitorHub storage', () => {
  it('writes a handful of rows per steady check run, whatever the monitor count', () => {
    const { hub, db } = createHub();
    const run = (now: number) =>
      hub.record(
        now,
        Array.from({ length: 50 }, (_, i) => check(`m${i}`, up(i))),
      );
    for (let i = 0; i < 12 * 60 + 5; i++) run(T0 + i * 60);

    const before = rowsWritten(db);
    run(T0 + (12 * 60 + 5) * 60);

    // sample insert, expired sample delete, last-update meta: 4,320 rows a day.
    expect(rowsWritten(db) - before).toBeLessThanOrEqual(3);
  });

  it('keeps its data when a second instance opens the same storage', () => {
    const { hub, db } = createHub();
    hub.record(T0, [check('api', down())]);

    const { hub: reopened } = createHub({}, db);

    expect(reopened.view().monitors.api?.status).toBe('down');
    expect(reopened.view().lastUpdate).toBe(T0);
  });

  it('answers repeated reads without a query until the next write', () => {
    const { hub, queries } = createHub();
    hub.record(T0, [check('api', up(10))]);
    hub.view();
    hub.latency('api');

    const before = queries();
    hub.view();
    hub.latency('api');
    hub.latency('db');
    expect(queries()).toBe(before);

    hub.record(T0 + 60, [check('api', up(20))]);
    expect(hub.latency('api').map(({ ping }) => ping)).toEqual([10, 20]);
    expect(hub.view().maintenances).toEqual([]);
    hub.putMaintenance({
      id: 'm',
      body: 'm',
      start: '2025-01-15T12:00:00Z',
      createdAt: 0,
      updatedAt: 0,
    });
    expect(hub.view().maintenances.map(({ id }) => id)).toEqual(['m']);
  });

  it('reports nothing before the first check run', () => {
    const { hub } = createHub();
    expect(hub.view()).toEqual({ lastUpdate: 0, monitors: {}, maintenances: [] });
  });
});

describe('MonitorHub maintenance windows', () => {
  const window = (id: string, start: number, end?: number, monitors?: string[]) => ({
    id,
    body: id,
    start: new Date(start * 1000).toISOString(),
    ...(end !== undefined && { end: new Date(end * 1000).toISOString() }),
    ...(monitors && { monitors }),
    createdAt: 0,
    updatedAt: 0,
  });

  it('keeps windows by id, oldest start first, and deletes them', () => {
    const { hub } = createHub();
    hub.putMaintenance(window('a-late', T0 + 600));
    hub.putMaintenance(window('b-early', T0));
    hub.putMaintenance({ ...window('b-early', T0), body: 'edited' });

    expect(hub.view().maintenances.map(({ id, body }) => [id, body])).toEqual([
      ['b-early', 'edited'],
      ['a-late', 'a-late'],
    ]);
    expect(hub.deleteMaintenance('a-late')).toBe(true);
    expect(hub.deleteMaintenance('a-late')).toBe(false);
    expect(hub.view().maintenances.map(({ id }) => id)).toEqual(['b-early']);
  });

  it('marks changes inside a window that covers the monitor, up to its end', () => {
    const { hub } = createHub();
    hub.putMaintenance(window('db-only', T0 - 60, T0 + 60, ['db']));
    hub.putMaintenance(window('everything', T0 + 120, T0 + 180));

    const inside = hub.record(T0, [check('db', down()), check('api', down())]);
    const atEnd = hub.record(T0 + 60, [check('db', down('Other'))]);
    const everything = hub.record(T0 + 120, [check('api', up())]);

    expect(inside.map((u) => [u.monitorId, u.inMaintenance])).toEqual([
      ['db', true],
      ['api', false],
    ]);
    expect(atEnd[0]?.inMaintenance).toBe(false);
    expect(everything[0]?.inMaintenance).toBe(true);
  });
});

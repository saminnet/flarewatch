import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vite-plus/test';
import type { CheckResult, HeartbeatMonitor, MonitorTarget } from '@flarewatch/shared';
import type { AlertPolicy } from '../../src/hub/alerts';
import type { CheckRecord } from '../../src/hub/monitor-hub';
import { createHub } from '../helpers/hub';

const T0 = Date.parse('2025-01-15T12:00:00Z') / 1000;
const DAY = 24 * 60 * 60;
const POLICY: AlertPolicy = { gracePeriodSeconds: 0, skipIds: [], skipErrorChanges: false };

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

    const [update] = hub.record(T0, [check('api', down())]).updates;

    expect(update).toEqual({
      monitorId: 'api',
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

    const [same] = hub.record(T0 + 60, [check('api', down('Timeout'))]).updates;
    const [changed] = hub.record(T0 + 120, [check('api', down('HTTP 502'))]).updates;
    const [recovered] = hub.record(T0 + 180, [check('api', up())]).updates;

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

  it('keeps a flapping monitor in one incident until it stays up for 15 minutes', () => {
    const { hub, db } = createHub();
    for (let i = 0; i < 1440; i++) {
      hub.record(T0 + i * 60, [check('api', i % 2 === 0 ? down() : up())]);
    }
    expect(hub.view().monitors.api).toMatchObject({
      status: 'down',
      incidents: [{ start: [T0], error: ['Unavailable'] }],
    });

    const lastUp = T0 + 1439 * 60;
    const held = createHub({}, db).hub.record(lastUp + 14 * 60, [check('api', up())]).updates;
    const closed = createHub({}, db).hub.record(lastUp + 15 * 60, [check('api', up())]).updates;

    expect(held).toMatchObject([{ statusChanged: false, isUp: true }]);
    expect(closed).toMatchObject([
      { statusChanged: true, changeType: 'up', incidentStartTime: T0 },
    ]);
    expect(hub.view().monitors.api).toMatchObject({
      status: 'up',
      incidents: [{ start: [T0], error: ['Unavailable'], end: lastUp }],
    });
  });

  it('alerts a flapping monitor only once it stays down for the grace period', () => {
    const { hub } = createHub();
    const policy = { ...POLICY, gracePeriodSeconds: 150 };
    const run = (now: number, result: CheckResult) =>
      hub.record(now, [check('api', result)], policy).alerts.map(({ kind }) => kind);
    const flaps = [down(), up(), down(), up(), down(), up(), down()].map((result, i) =>
      run(T0 + i * 60, result),
    );

    expect(flaps.flat()).toEqual([]);
    expect(run(T0 + 420, down())).toEqual([]);
    expect(run(T0 + 480, down())).toEqual([]);
    expect(run(T0 + 540, down())).toEqual(['down']);
  });

  it('restarts a recovery hold when the monitor fails with a new error', () => {
    const { hub } = createHub();
    hub.record(T0, [check('api', down())]);
    hub.record(T0 + 60, [check('api', up())]);
    hub.record(T0 + 120, [check('api', down())]);
    hub.record(T0 + 180, [check('api', up())]);
    hub.record(T0 + 240, [check('api', down('Other'))]);
    hub.record(T0 + 300, [check('api', up())]);

    hub.record(T0 + 180 + 15 * 60, [check('api', up())]);
    expect(hub.view().monitors.api?.status).toBe('down');
    hub.record(T0 + 300 + 15 * 60, [check('api', up())]);
    expect(hub.view().monitors.api?.incidents).toEqual([
      { start: [T0, T0 + 240], error: ['Unavailable', 'Other'], end: T0 + 300 },
    ]);
  });

  it('opens a new incident when the monitor fails more than 15 minutes after recovering', () => {
    const { hub } = createHub();
    hub.record(T0, [check('api', down('Timeout'))]);
    hub.record(T0 + 60, [check('api', up())]);

    const [update] = hub.record(T0 + 60 + 15 * 60 + 1, [check('api', down('HTTP 502'))]).updates;

    expect(update).toMatchObject({ changeType: 'down', incidentStartTime: T0 + 60 + 15 * 60 + 1 });
    expect(hub.view().monitors.api?.incidents).toEqual([
      { start: [T0], error: ['Timeout'], end: T0 + 60 },
      { start: [T0 + 60 + 15 * 60 + 1], error: ['HTTP 502'] },
    ]);
  });

  it('adds a segment when a reopened incident fails with a new error', () => {
    const { hub } = createHub();
    hub.record(T0, [check('api', down('Timeout'))]);
    hub.record(T0 + 60, [check('api', up())]);

    const [update] = hub.record(T0 + 120, [check('api', down('HTTP 502'))]).updates;

    expect(update).toMatchObject({
      changeType: 'down',
      statusChanged: true,
      incidentStartTime: T0,
    });
    expect(hub.view().monitors.api?.incidents).toEqual([
      { start: [T0, T0 + 120], error: ['Timeout', 'HTTP 502'] },
    ]);
  });

  it('keeps a monitor’s newest 1,000 closed incidents', () => {
    const { hub } = createHub();
    const gap = 17 * 60;
    for (let i = 0; i < 1002; i++) {
      hub.record(T0 + i * gap, [check('api', down(`err-${i}`))]);
      hub.record(T0 + i * gap + 60, [check('api', up())]);
    }
    const closed = hub.view().monitors.api?.incidents ?? [];
    expect(closed).toHaveLength(1000);
    expect(closed[0]?.error).toEqual(['err-2']);
    hub.record(T0 + 1002 * gap, [check('api', down('err-1002'))]);

    const incidents = hub.view().monitors.api?.incidents ?? [];
    expect(incidents).toHaveLength(1001);
    expect(incidents[0]?.error).toEqual(['err-2']);
    expect(incidents[1000]).toEqual({ start: [T0 + 1002 * gap], error: ['err-1002'] });
  }, 30_000);

  it('keeps a history too long for one storage row', () => {
    const { hub, db } = createHub();
    const gap = 17 * 60;
    const error = (i: number) => `err-${i} `.padEnd(500, 'x');
    for (let i = 0; i < 1002; i++) {
      hub.record(T0 + i * gap, [check('api', down(error(i)))]);
      hub.record(T0 + i * gap + 60, [check('api', up())]);
    }
    hub.record(T0 + 1002 * gap, [check('api', down(error(1002)))]);
    hub.record(T0 + 1002 * gap + 60, [check('api', down('Timeout'))]);

    const incidents = createHub({}, db).hub.view().monitors.api?.incidents ?? [];
    expect(incidents).toHaveLength(1001);
    expect(incidents[0]).toEqual({
      start: [T0 + 2 * gap],
      error: [error(2)],
      end: T0 + 2 * gap + 60,
    });
    expect(incidents[999]?.error).toEqual([error(1001)]);
    expect(incidents[1000]).toEqual({
      start: [T0 + 1002 * gap, T0 + 1002 * gap + 60],
      error: [error(1002), 'Timeout'],
    });
  }, 30_000);

  it('keeps about a megabyte of history per monitor, dropping the oldest', () => {
    const { hub, db } = createHub();
    const gap = 2 * 3600;
    // 25 outages whose 500-character error changes 100 times each.
    for (let i = 0; i < 25; i++) {
      for (let j = 0; j < 100; j++) {
        hub.record(T0 + i * gap + j * 60, [check('api', down(`${i}-${j} `.padEnd(500, 'x')))]);
      }
      hub.record(T0 + i * gap + 100 * 60, [check('api', up())]);
    }

    hub.record(T0 + 25 * gap, [check('api', down('New'))]);

    const incidents = createHub({}, db).hub.view().monitors.api?.incidents ?? [];
    expect(JSON.stringify(incidents.slice(0, -1)).length).toBeLessThanOrEqual(1_000_000);
    expect(incidents.length).toBeGreaterThan(10);
    expect(incidents[incidents.length - 2]?.end).toBe(T0 + 24 * gap + 100 * 60);
    expect(incidents[incidents.length - 1]).toEqual({ start: [T0 + 25 * gap], error: ['New'] });
  }, 30_000);

  it('stores the first 500 characters of an error', () => {
    const { hub } = createHub();
    const long = 'x'.repeat(600);

    const [first] = hub.record(T0, [check('api', down(long))]).updates;
    const [same] = hub.record(T0 + 60, [check('api', down(`${long}y`))]).updates;

    expect(first?.error).toBe('x'.repeat(500));
    expect(same?.statusChanged).toBe(false);
    expect(hub.view().monitors.api?.incidents).toEqual([{ start: [T0], error: ['x'.repeat(500)] }]);
  });

  it('keeps an open incident and drops closed ones 90 days after they end', () => {
    const { hub } = createHub();
    hub.record(T0, [check('old', down()), check('open', down())]);
    hub.record(T0 + 60, [check('old', up()), check('open', down())]);

    hub.record(T0 + 60 + 90 * DAY + 1, [check('old', up()), check('open', down())]);

    const { monitors } = hub.view();
    expect(monitors.old?.incidents).toEqual([]);
    expect(monitors.open?.incidents).toHaveLength(1);
  });

  it('ends the outage of a monitor that left the config and forgets it with its incidents', () => {
    const { hub } = createHub();
    hub.record(T0, [check('api', down()), check('gone', down())]);
    hub.view();

    hub.record(T0 + 60, [check('api', down())]);
    expect(hub.view().monitors.gone).toMatchObject({
      status: 'up',
      incidents: [{ start: [T0], error: ['Unavailable'], end: T0 + 60 }],
    });

    hub.record(T0 + 60 + 90 * DAY + 1, [check('api', down())]);
    expect(hub.view().monitors.gone).toBeUndefined();
    expect(hub.view().monitors.api?.incidents).toEqual([{ start: [T0], error: ['Unavailable'] }]);
  });

  it('ignores a check run that started before the last one it recorded', () => {
    const { hub } = createHub();
    hub.record(T0, [check('api', down())]);
    hub.record(T0 + 120, [check('api', up(20))]);

    const late = hub.record(T0 + 60, [check('api', down('Late'))], POLICY);

    expect(late).toEqual({ updates: [], alerts: [] });
    expect(hub.view()).toMatchObject({
      lastUpdate: T0 + 120,
      monitors: {
        api: { status: 'up', incidents: [{ start: [T0], error: ['Unavailable'], end: T0 + 120 }] },
      },
    });
    expect(hub.latency('api', T0 + 120)).toEqual([
      { ping: 0, loc: 'HEL', time: T0 },
      { ping: 20, loc: 'HEL', time: T0 + 120 },
    ]);
  });

  it('shows each incident change in a view read before it', () => {
    const { hub } = createHub();
    const incidents = () => hub.view().monitors.api?.incidents;
    const segments = { start: [T0 + 60, T0 + 120], error: ['Timeout', 'HTTP 502'] };

    hub.record(T0, [check('api', up())]);
    expect(incidents()).toEqual([]);
    hub.record(T0 + 60, [check('api', down('Timeout'))]);
    expect(incidents()).toEqual([{ start: [T0 + 60], error: ['Timeout'] }]);
    hub.record(T0 + 120, [check('api', down('HTTP 502'))]);
    expect(incidents()).toEqual([segments]);
    hub.record(T0 + 180, [check('api', up())]);
    expect(incidents()).toEqual([{ ...segments, end: T0 + 180 }]);
    hub.record(T0 + 240, [check('api', down('HTTP 502'))]);
    expect(incidents()).toEqual([segments]);
    hub.record(T0 + 300, [check('api', up())]);
    expect(incidents()).toEqual([segments]);
    hub.record(T0 + 300 + 15 * 60, [check('api', up())]);
    expect(incidents()).toEqual([{ ...segments, end: T0 + 300 }]);
    hub.record(T0 + 300 + 90 * DAY + 1, [check('api', up())]);
    expect(incidents()).toEqual([]);
  });
});

describe('MonitorHub latency', () => {
  it('keeps one sample per check run for 12 hours', () => {
    const { hub } = createHub();
    hub.record(T0, [check('api', up(30))]);
    hub.record(T0 + 60, [check('api', up(40), 'AMS')]);
    hub.record(T0 + 12 * 60 * 60 + 30, [check('api', up(50))]);

    expect(hub.latency('api', T0 + 12 * 60 * 60 + 30)).toEqual([
      { ping: 40, loc: 'AMS', time: T0 + 60 },
      { ping: 50, loc: 'HEL', time: T0 + 12 * 60 * 60 + 30 },
    ]);
    expect(hub.view().monitors.api?.latest).toEqual({
      ping: 50,
      loc: 'HEL',
      time: T0 + 12 * 60 * 60 + 30,
    });
  });

  it('keeps the first 64 characters of a location', () => {
    const { hub } = createHub();
    hub.record(T0, [check('api', up(1), 'x'.repeat(100))]);

    expect(hub.latency('api', T0)).toEqual([{ ping: 1, loc: 'x'.repeat(64), time: T0 }]);
  });

  it('returns only the asked monitor and handles ids that look like JSON paths', () => {
    const { hub } = createHub();
    hub.record(T0, [check('a.b', up(1)), check('$[0]', up(2)), check('x"y', up(3))]);

    expect(hub.latency('a.b', T0)).toEqual([{ ping: 1, loc: 'HEL', time: T0 }]);
    expect(hub.latency('$[0]', T0)).toEqual([{ ping: 2, loc: 'HEL', time: T0 }]);
    expect(hub.latency('x"y', T0)).toEqual([{ ping: 3, loc: 'HEL', time: T0 }]);
  });

  it('shows no samples for a monitor without any whose id names an object property', () => {
    const { hub } = createHub();
    const job: HeartbeatMonitor = {
      id: 'constructor',
      name: 'Job',
      method: 'HEARTBEAT',
      periodSeconds: 3600,
      graceSeconds: 600,
    };
    hub.record(T0, [check('api', up(1)), { monitor: job }]);

    expect(hub.latency('constructor', T0)).toEqual([]);
    expect(hub.view().monitors.constructor).not.toHaveProperty('latest');
  });

  it('returns only the 12 hours before now once check runs have stopped', () => {
    const { hub } = createHub();
    hub.record(T0, [check('api', up(10))]);
    hub.record(T0 + 60, [check('api', up(20))]);

    expect(hub.latency('api', T0 + 12 * 60 * 60 + 30)).toEqual([
      { ping: 20, loc: 'HEL', time: T0 + 60 },
    ]);
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

    const { updates } = hub.record(T0, [{ monitor: job }]);

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

    const [update] = hub.record(T0 + 60, [{ monitor: job }]).updates;
    expect(update).toMatchObject({ changeType: 'up', incidentStartTime: T0 + 1 });
    expect(hub.view().monitors.backup?.status).toBe('up');
    expect(hub.view().monitors.backup?.heartbeat).not.toHaveProperty('message');
  });

  it('forgets the job once its id becomes a checked monitor', () => {
    const { hub } = createHub();
    hub.ping(job, 'fail', T0, 'disk full');
    hub.record(T0 + 1, [{ monitor: job }]);

    hub.record(T0 + 60, [check('backup', up())]);

    expect(hub.view().monitors.backup).toMatchObject({ status: 'up' });
    expect(hub.view().monitors.backup).not.toHaveProperty('heartbeat');
  });
});

describe('MonitorHub storage', () => {
  it('keeps its data when a second instance opens the same storage', () => {
    const { hub, db } = createHub();
    hub.record(T0, [check('api', down())]);

    const { hub: reopened } = createHub({}, db);

    expect(reopened.view().monitors.api?.status).toBe('down');
    expect(reopened.view().lastUpdate).toBe(T0);
  });

  it('shows every outage after hibernation', () => {
    const { hub, db } = createHub();
    for (let i = 0; i < 300; i++) {
      hub.record(T0 + i * 20 * 60, [check('api', down()), check('db', up())]);
      hub.record(T0 + i * 20 * 60 + 60, [check('api', up()), check('db', up())]);
    }

    expect(createHub({}, db).hub.view().monitors.api?.incidents).toHaveLength(300);
  });

  it('keeps a chart’s 12 hours of samples after hibernation', () => {
    const { hub, db } = createHub();
    for (let i = 0; i <= 12 * 60; i++) hub.record(T0 + i * 60, [check('api', up(i))]);

    expect(createHub({}, db).hub.latency('api', T0 + 12 * 60 * 60)).toHaveLength(12 * 60 + 1);
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

  it('refuses a new window past 100 and still updates an existing one', () => {
    const { hub } = createHub();
    for (let index = 1; index <= 100; index++) {
      expect(hub.putMaintenance(window(`w${index}`, T0))).toBe(true);
    }

    expect(hub.putMaintenance(window('w101', T0))).toBe(false);
    expect(hub.putMaintenance({ ...window('w50', T0), body: 'edited' })).toBe(true);

    const stored = hub.view().maintenances;
    expect(stored).toHaveLength(100);
    expect(stored.find(({ id }) => id === 'w50')?.body).toBe('edited');
    expect(stored.some(({ id }) => id === 'w101')).toBe(false);
  });

  it('deletes a window 90 days after it ends and keeps one without an end', () => {
    const { hub } = createHub();
    hub.putMaintenance(window('expired', T0 - 100 * DAY, T0 - 90 * DAY - 1));
    hub.putMaintenance({
      ...window('expired-ms', T0 - 100 * DAY),
      end: (T0 - 90 * DAY - 1) * 1000,
    });
    hub.putMaintenance(window('recent', T0 - 100 * DAY, T0 - 89 * DAY));
    hub.putMaintenance(window('open', T0 - 200 * DAY));

    hub.record(T0, [check('api', up())]);

    expect(hub.view().maintenances.map(({ id }) => id)).toEqual(['open', 'recent']);
  });

  it('deletes a repeating window 90 days after its until and never one without', () => {
    const { hub } = createHub();
    const daily = (id: string, start: number, until?: number) => ({
      ...window(id, start, start + 3600),
      repeat: {
        every: 'day' as const,
        ...(until !== undefined && { until: new Date(until * 1000).toISOString() }),
      },
    });
    hub.putMaintenance(daily('ended', T0 - 180 * DAY, T0 - 91 * DAY));
    hub.putMaintenance(daily('recent', T0 - 150 * DAY, T0 - 90 * DAY));
    hub.putMaintenance(daily('forever', T0 - 200 * DAY));

    hub.record(T0, [check('api', up())]);

    expect(hub.view().maintenances.map(({ id }) => id)).toEqual(['forever', 'recent']);
  });

  it('neither throws on nor uses a stored row with a zone that is not normalized', () => {
    const { hub } = createHub();
    const nightly = (id: string, timeZone: string) => ({
      ...window(id, T0 - 10 * DAY - 60, T0 - 10 * DAY + 60, ['db']),
      repeat: { every: 'day' as const, timeZone },
    });
    hub.putMaintenance(nightly('padded', ' Europe/Berlin '));
    hub.putMaintenance(nightly('unknown', 'Mars/Olympus'));

    const run = hub.record(T0, [check('db', down())], POLICY);

    expect(run.alerts.map(({ monitorId }) => monitorId)).toEqual(['db']);
    expect(hub.view().maintenances).toEqual([]);
  });

  it("holds back alerts during a repeating window's run, not between runs", () => {
    const { hub } = createHub();
    hub.putMaintenance({
      ...window('nightly', T0 - 10 * DAY - 60, T0 - 10 * DAY + 60, ['db']),
      repeat: { every: 'day' },
    });

    const inside = hub.record(T0, [check('db', down())], POLICY);
    const afterRun = hub.record(T0 + 60, [check('db', down('Other'))], POLICY);

    expect(inside.alerts).toEqual([]);
    expect(afterRun.alerts.map(({ monitorId }) => monitorId)).toEqual(['db']);
  });

  it('holds back alerts inside a window that covers the monitor, up to its end', () => {
    const { hub } = createHub();
    hub.putMaintenance(window('db-only', T0 - 60, T0 + 60, ['db']));
    hub.putMaintenance(window('everything', T0 + 120, T0 + 180));

    const inside = hub.record(T0, [check('db', down()), check('api', down())], POLICY);
    const atEnd = hub.record(T0 + 60, [check('db', down('Other'))], POLICY);
    const everything = hub.record(T0 + 120, [check('web', down())], POLICY);

    expect(inside.alerts.map(({ monitorId }) => monitorId)).toEqual(['api']);
    expect(atEnd.alerts.map(({ monitorId }) => monitorId)).toEqual(['db']);
    expect(everything.alerts).toEqual([]);
  });
});

describe('MonitorHub after an upgrade from a release without alert tracking', () => {
  it('never alerts for an incident that was already open, and alerts for the next one', () => {
    // The schema as releases before alert tracking left it, with one open incident.
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE _migrations (id INTEGER PRIMARY KEY);
      INSERT INTO _migrations (id) VALUES (1), (2);
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
      CREATE TABLE monitors (id TEXT PRIMARY KEY, started_at INTEGER, heartbeat TEXT) WITHOUT ROWID;
      CREATE TABLE incidents (
        id INTEGER PRIMARY KEY, monitor_id TEXT NOT NULL, starts TEXT NOT NULL,
        errors TEXT NOT NULL, end_at INTEGER
      );
      CREATE TABLE samples (at INTEGER PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE maintenances (id TEXT PRIMARY KEY, data TEXT NOT NULL) WITHOUT ROWID;
      INSERT INTO monitors (id, started_at) VALUES ('api', ${T0 - 3600});
      INSERT INTO incidents (monitor_id, starts, errors) VALUES ('api', '[${T0 - 600}]', '["Timeout"]');
    `);
    const { hub } = createHub({}, db);

    expect(hub.record(T0, [check('api', down('HTTP 502'))], POLICY).alerts).toEqual([]);
    expect(hub.record(T0 + 60, [check('api', up())], POLICY).alerts).toEqual([]);
    expect(hub.record(T0 + 120, [check('api', down())], POLICY).alerts).toMatchObject([
      { monitorId: 'api', kind: 'down' },
    ]);
  });
});

describe('MonitorHub after an upgrade from 3.2', () => {
  it('reminds about an outage alerted before the upgrade once 30 runs have passed since it', () => {
    const db = new DatabaseSync(':memory:');
    const before = createHub({}, db).hub;
    const { alerts } = before.record(T0, [check('api', down())], POLICY);
    before.confirmAlerts(
      alerts.map(({ incident, kind, reopenedAt, run }) => ({
        incident,
        kind,
        reopenedAt,
        run,
        delivered: true,
      })),
    );
    // The schema 3.2.0 left behind.
    db.exec(`
      DELETE FROM _migrations WHERE id >= 8;
      ALTER TABLE meta DROP COLUMN runs;
      ALTER TABLE incidents DROP COLUMN alert_run;
      ALTER TABLE incidents DROP COLUMN reminders;
    `);
    const { hub } = createHub({}, db);
    const api: CheckRecord = {
      monitor: { ...monitor('api'), reminderEveryChecks: 30 },
      check: { location: 'HEL', result: down() },
    };

    const kinds = Array.from({ length: 30 }, (_, i) =>
      hub.record(T0 + (i + 1) * 60, [api], POLICY).alerts.map(({ kind }) => kind),
    );

    expect(kinds.flat()).toEqual(['reminder']);
    expect(kinds[29]).toEqual(['reminder']);
  });
});

/** Rewinds a new hub's storage to the schema 3.1.0 left behind. */
function rewindTo31(db: DatabaseSync): void {
  db.exec(`
    DELETE FROM _migrations WHERE id >= 7;
    ALTER TABLE meta DROP COLUMN runs;
    ALTER TABLE incidents DROP COLUMN alert_run;
    ALTER TABLE incidents DROP COLUMN reminders;
    DROP TABLE incident_lists;
    DROP TABLE latency;
    ALTER TABLE incidents DROP COLUMN up_since;
  `);
}

function addIncident(
  db: DatabaseSync,
  monitorId: string,
  starts: number[],
  errors: string[],
  end?: number,
) {
  db.prepare('INSERT INTO incidents (monitor_id, starts, errors, end_at) VALUES (?, ?, ?, ?)').run(
    monitorId,
    JSON.stringify(starts),
    JSON.stringify(errors),
    end ?? null,
  );
}

describe('MonitorHub after an upgrade from 2.x', () => {
  it('drops the 1.x import bookkeeping and keeps the rest', () => {
    const db = new DatabaseSync(':memory:');
    const { hub } = createHub({}, db);
    hub.record(T0, [check('api', up())]);
    // Rewind to the schema 2.x left behind, with its import rows.
    rewindTo31(db);
    db.exec(`
      DELETE FROM _migrations WHERE id >= 4;
      DROP INDEX incidents_end_at;
      DROP INDEX incidents_monitor_end;
      ALTER TABLE incidents DROP COLUMN reopened_at;
      ALTER TABLE incidents DROP COLUMN error_alerts;
      INSERT INTO meta (key, value) VALUES ('v1_import', '1'), ('v1_import_marked', '1');
    `);

    const upgraded = createHub({}, db).hub;

    const keys = db.prepare('SELECT key FROM meta ORDER BY key').all();
    expect(keys).toEqual([{ key: 'last_update' }]);
    expect(upgraded.view().lastUpdate).toBe(T0);
  });
});

describe('MonitorHub after an upgrade from 3.1', () => {
  it('keeps the history, an outage still open, and the last 12 hours of latency', () => {
    const db = new DatabaseSync(':memory:');
    createHub({}, db).hub.record(T0, [check('api', up()), check('db', up())]);
    rewindTo31(db);
    addIncident(db, 'api', [T0 - 7200], ['Timeout'], T0 - 7000);
    addIncident(db, 'api', [T0 - 3600, T0 - 3500], ['Timeout', 'HTTP 502'], T0 - 3400);
    addIncident(db, 'db', [T0 - 300], ['Refused']);
    // An hour of 70 runs, each 30,000 bytes: too large for one row.
    const insert = db.prepare('INSERT INTO samples (at, data) VALUES (?, ?)');
    for (let i = 0; i < 70; i++) {
      insert.run(T0 - 3 * 3600 + i * 30, `{"api":[7,"${'漢'.repeat(10_000)}"]}`);
    }
    db.exec(`
      INSERT INTO samples (at, data) VALUES
        (${T0 - 13 * 3600}, '{"api":[5,"HEL"]}'),
        (${T0 - 120}, 'not json'),
        (${T0 - 60}, '{"api":[10,"HEL"],"db":[0,"AMS"]}'),
        (${T0}, '{"api":[20,"HEL"]}');
    `);

    const { hub } = createHub({}, db);

    expect(hub.view().monitors.api).toMatchObject({
      status: 'up',
      incidents: [
        { start: [T0 - 7200], error: ['Timeout'], end: T0 - 7000 },
        { start: [T0 - 3600, T0 - 3500], error: ['Timeout', 'HTTP 502'], end: T0 - 3400 },
      ],
    });
    expect(hub.view().monitors.db).toMatchObject({
      status: 'down',
      incidents: [{ start: [T0 - 300], error: ['Refused'] }],
    });
    expect(hub.latency('api', T0)).toEqual([
      { ping: 10, loc: 'HEL', time: T0 - 60 },
      { ping: 20, loc: 'HEL', time: T0 },
    ]);
    // Older than the last 12 hours 3.1.0 kept, so not moved.
    expect(hub.latency('api', T0 - 12 * 3600).map(({ ping }) => ping)).toEqual([10, 20]);
    expect(db.prepare('SELECT count(*) AS n FROM samples').get()).toEqual({ n: 0 });

    hub.record(T0 + 60, [check('api', up()), check('db', down('Refused'))]);
    expect(hub.view().monitors.db?.status).toBe('down');
    hub.record(T0 + 120, [check('api', up()), check('db', up())]);
    expect(hub.view().monitors.db?.incidents).toEqual([
      { start: [T0 - 300], error: ['Refused'], end: T0 + 120 },
    ]);
  });

  it('moves the incidents it can read past one it cannot', () => {
    const db = new DatabaseSync(':memory:');
    createHub({}, db).hub.record(T0, [check('api', up())]);
    rewindTo31(db);
    db.exec(`INSERT INTO incidents (monitor_id, starts, errors, end_at)
      VALUES ('api', 'not json', '{"broken', ${T0 - 7000})`);
    addIncident(db, 'api', [T0 - 3600], ['Timeout'], T0 - 3400);

    expect(createHub({}, db).hub.view().monitors.api?.incidents).toEqual([
      { start: [T0 - 3600], error: ['Timeout'], end: T0 - 3400 },
    ]);
  });

  it('keeps a monitor’s newest 1,000 closed incidents and cuts long errors', () => {
    const db = new DatabaseSync(':memory:');
    createHub({}, db).hub.record(T0, [check('api', up())]);
    rewindTo31(db);
    for (let i = 1; i <= 1005; i++)
      addIncident(db, 'api', [T0 + i * 100], ['Timeout'], T0 + i * 100 + 50);
    addIncident(db, 'api', [T0 + 200_000], ['x'.repeat(600)]);

    const incidents = createHub({}, db).hub.view().monitors.api?.incidents ?? [];

    expect(incidents).toHaveLength(1001);
    expect(incidents[0]?.start).toEqual([T0 + 600]);
    expect(incidents[999]?.end).toBe(T0 + 100_550);
    expect(incidents[1000]).toEqual({ start: [T0 + 200_000], error: ['x'.repeat(500)] });
  });

  it('keeps about a megabyte of a monitor’s history, dropping the oldest', () => {
    const db = new DatabaseSync(':memory:');
    createHub({}, db).hub.record(T0, [check('api', up())]);
    rewindTo31(db);
    // 25 outages whose 500-character error changed 100 times each.
    for (let i = 0; i < 25; i++) {
      const starts = Array.from({ length: 100 }, (_, j) => T0 + i * 7200 + j * 60);
      const errors = Array.from({ length: 100 }, (_, j) => `${i}-${j} `.padEnd(500, 'x'));
      addIncident(db, 'api', starts, errors, T0 + i * 7200 + 6000);
    }

    const incidents = createHub({}, db).hub.view().monitors.api?.incidents ?? [];

    expect(JSON.stringify(incidents).length).toBeLessThanOrEqual(1_000_000);
    expect(incidents.length).toBeGreaterThan(10);
    expect(incidents[incidents.length - 1]?.end).toBe(T0 + 24 * 7200 + 6000);
  });
});

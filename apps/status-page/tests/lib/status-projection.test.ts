import { describe, expect, it } from 'vite-plus/test';
import type { Maintenance, MonitorView, StatusView } from '@flarewatch/shared';
import type { PublicMonitor } from '@/lib/public-view';
import { projectBadgeStatus, projectPublicData, projectTimeline } from '@/lib/status-projection';

function createState(
  monitors: Record<string, Partial<MonitorView>> = {},
  lastUpdate = 1_789_000_000,
): StatusView {
  return {
    lastUpdate,
    monitors: Object.fromEntries(
      Object.entries(monitors).map(([id, monitor]) => [
        id,
        { status: 'up', incidents: [], ...monitor },
      ]),
    ),
  };
}

function publicMonitor(id: string, name = id): PublicMonitor {
  return { id, method: 'GET', name };
}

function jobMonitor(id: string): PublicMonitor {
  return { id, method: 'HEARTBEAT', name: id };
}

function maintenance(id: string, start: string, end?: string, monitors?: string[]): Maintenance {
  return {
    id,
    start,
    ...(end && { end }),
    ...(monitors && { monitors }),
    body: id,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('status projection', () => {
  it('projects public data without exposing raw monitor state', () => {
    const state = createState({
      api: { startedAt: 1_788_000_000, latest: { loc: 'SFO', ping: 42, time: 1_789_000_000 } },
      web: {
        status: 'down',
        startedAt: 1_788_000_000,
        incidents: [{ start: [1_788_999_000], end: undefined, error: ['Timeout'] }],
        latest: { loc: 'FRA', ping: 120, time: 1_789_000_000 },
      },
    });

    expect(
      projectPublicData([publicMonitor('api', 'API'), publicMonitor('web', 'Web')], state, []),
    ).toEqual({
      up: 1,
      down: 1,
      updatedAt: 1_789_000_000,
      monitors: {
        api: {
          up: true,
          status: 'up',
          latency: 42,
          location: 'SFO',
          message: 'OK',
        },
        web: {
          up: false,
          status: 'down',
          latency: 120,
          location: 'FRA',
          message: 'Timeout',
        },
      },
    });
  });

  it('projects null latency and a fallback message for monitors without data', () => {
    const state = createState({
      web: {
        status: 'down',
        incidents: [{ start: [1_788_999_000], end: undefined, error: [] }],
      },
    });

    expect(projectPublicData([publicMonitor('web', 'Web')], state, [])).toEqual({
      up: 0,
      down: 1,
      updatedAt: 1_789_000_000,
      monitors: {
        web: {
          up: false,
          status: 'down',
          latency: null,
          location: null,
          message: 'Unknown error',
        },
      },
    });
  });

  it('counts late, pending and running jobs as up in public data and names their state', () => {
    const state = createState({
      api: { status: 'up' },
      late: { status: 'late', heartbeat: { status: 'late' } },
      pending: { status: 'pending', heartbeat: { status: 'pending' } },
      running: { status: 'running', heartbeat: { status: 'running' } },
      web: { status: 'down', incidents: [{ start: [1_788_999_000], error: ['Timeout'] }] },
    });
    const projected = projectPublicData(
      [
        publicMonitor('api'),
        jobMonitor('late'),
        jobMonitor('pending'),
        jobMonitor('running'),
        publicMonitor('web'),
      ],
      state,
      [],
    );

    expect(projected).toMatchObject({ up: 4, down: 1 });
    expect(
      Object.fromEntries(
        Object.entries(projected.monitors).map(([id, m]) => [id, [m.up, m.status]]),
      ),
    ).toEqual({
      api: [true, 'up'],
      late: [true, 'degraded'],
      pending: [true, 'pending'],
      running: [true, 'running'],
      web: [false, 'down'],
    });
  });

  it('projects badge status as unknown when the monitor has no state', () => {
    expect(projectBadgeStatus(publicMonitor('api'), createState(), [])).toEqual({
      status: 'unknown',
    });
  });

  it('projects badge status as unknown until the monitor has its first check result', () => {
    const state = createState({ api: { status: 'up' } });

    expect(projectBadgeStatus(publicMonitor('api'), state, [])).toEqual({ status: 'unknown' });
  });

  it('projects badge status as known once the monitor has a check result', () => {
    const state = createState({
      api: {
        status: 'down',
        startedAt: 1_788_999_000,
        incidents: [{ start: [1_788_999_000], end: undefined, error: ['Down'] }],
        latest: { loc: 'SFO', ping: 42, time: 1_789_000_000 },
      },
      web: { status: 'up', startedAt: 1_788_999_000 },
    });

    expect(projectBadgeStatus(publicMonitor('api'), state, [])).toEqual({ status: 'down' });
    expect(projectBadgeStatus(publicMonitor('web'), state, [])).toEqual({ status: 'up' });
  });

  it('projects a heartbeat badge from heartbeat state, which carries no latency', () => {
    const incidents = [{ start: [1_788_999_000], end: 1_789_000_000, error: ['Late'] }];

    expect(
      projectBadgeStatus(
        jobMonitor('job'),
        createState({
          job: { status: 'up', startedAt: 1_788_999_000, incidents, heartbeat: { status: 'up' } },
        }),
        [],
      ),
    ).toEqual({ status: 'up' });
    expect(
      projectBadgeStatus(
        jobMonitor('job'),
        createState({ job: { status: 'pending', incidents, heartbeat: { status: 'pending' } } }),
        [],
      ),
    ).toEqual({ status: 'unknown' });
  });

  it('projects a check slower than its maxLatencyMs as degraded but still up', () => {
    const slow: PublicMonitor = { ...publicMonitor('api'), maxLatencyMs: 500 };
    const state = createState({
      api: { startedAt: 1_788_000_000, latest: { loc: 'FRA', ping: 900, time: 1_789_000_000 } },
    });

    expect(projectPublicData([slow], state, [])).toEqual({
      up: 1,
      down: 0,
      updatedAt: 1_789_000_000,
      monitors: {
        api: { up: true, status: 'degraded', latency: 900, location: 'FRA', message: 'OK' },
      },
    });
    expect(projectBadgeStatus(slow, state, [])).toEqual({ status: 'degraded' });

    const window = [maintenance('m1', '2026-09-09T00:00:00.000Z', undefined, ['api'])];
    expect(projectPublicData([slow], state, window).monitors.api?.status).toBe('up');
    expect(projectBadgeStatus(slow, state, window)).toEqual({ status: 'up' });
  });

  it('projects a late job badge as degraded and a running job badge as up', () => {
    const job = (status: 'late' | 'running') =>
      createState({ job: { status, startedAt: 1_788_999_000, heartbeat: { status } } });

    expect(projectBadgeStatus(jobMonitor('job'), job('late'), [])).toEqual({ status: 'degraded' });
    expect(projectBadgeStatus(jobMonitor('job'), job('running'), [])).toEqual({ status: 'up' });
  });

  it('orders incident and maintenance timeline events by start descending', () => {
    const monthStart = new Date('2026-06-01T00:00:00.000Z');
    const monthEnd = new Date('2026-07-01T00:00:00.000Z');
    const state = createState(
      {
        api: {
          incidents: [
            {
              start: [Date.parse('2026-06-05T10:00:00.000Z') / 1000],
              end: Date.parse('2026-06-05T10:30:00.000Z') / 1000,
              error: ['API error'],
            },
          ],
        },
        web: {
          incidents: [
            {
              start: [Date.parse('2026-06-07T10:00:00.000Z') / 1000],
              end: Date.parse('2026-06-07T10:30:00.000Z') / 1000,
              error: ['Web error'],
            },
          ],
        },
      },
      Date.parse('2026-06-10T12:00:00.000Z') / 1000,
    );

    const result = projectTimeline({
      state,
      monitors: [publicMonitor('api', 'API'), publicMonitor('web', 'Web')],
      maintenances: [maintenance('past', '2026-06-03T00:00:00.000Z', '2026-06-03T01:00:00.000Z')],
      monthStart,
      monthEnd,
      nowMs: Date.parse('2026-06-10T12:00:00.000Z'),
      eventType: 'all',
    });

    expect(result.pinned).toEqual([]);
    expect(
      result.timeline.map((event) =>
        event.type === 'incident' ? event.monitorId : event.maintenance.id,
      ),
    ).toEqual(['web', 'api', 'past']);
  });

  it('uses provided now for open incidents without lastUpdate', () => {
    const monthStart = new Date('2026-06-01T00:00:00.000Z');
    const monthEnd = new Date('2026-07-01T00:00:00.000Z');
    const state = createState(
      {
        api: {
          status: 'down',
          incidents: [
            {
              start: [Date.parse('2026-05-20T10:00:00.000Z') / 1000],
              end: undefined,
              error: ['Still down'],
            },
          ],
        },
      },
      0,
    );

    const result = projectTimeline({
      state,
      monitors: [publicMonitor('api', 'API')],
      maintenances: [],
      monthStart,
      monthEnd,
      nowMs: Date.parse('2026-06-10T12:00:00.000Z'),
      eventType: 'incident',
    });

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]).toMatchObject({
      type: 'incident',
      monitorId: 'api',
      start: Date.parse('2026-05-20T10:00:00.000Z') / 1000,
      end: undefined,
    });
  });

  it('excludes incidents outside the selected month', () => {
    const monthStart = new Date('2026-06-01T00:00:00.000Z');
    const monthEnd = new Date('2026-07-01T00:00:00.000Z');
    const state = createState(
      {
        may: {
          incidents: [
            {
              start: [Date.parse('2026-05-05T10:00:00.000Z') / 1000],
              end: Date.parse('2026-05-06T10:00:00.000Z') / 1000,
              error: ['May outage'],
            },
          ],
        },
        crossing: {
          incidents: [
            {
              start: [Date.parse('2026-05-28T10:00:00.000Z') / 1000],
              end: Date.parse('2026-06-03T10:00:00.000Z') / 1000,
              error: ['Crossing outage'],
            },
          ],
        },
        july: {
          status: 'down',
          incidents: [
            {
              start: [Date.parse('2026-07-02T10:00:00.000Z') / 1000],
              end: undefined,
              error: ['July outage'],
            },
          ],
        },
      },
      Date.parse('2026-06-10T12:00:00.000Z') / 1000,
    );

    const result = projectTimeline({
      state,
      monitors: [
        publicMonitor('may', 'May'),
        publicMonitor('crossing', 'Crossing'),
        publicMonitor('july', 'July'),
      ],
      maintenances: [],
      monthStart,
      monthEnd,
      nowMs: Date.parse('2026-06-10T12:00:00.000Z'),
      eventType: 'incident',
    });

    expect(
      result.timeline.map((event) => (event.type === 'incident' ? event.monitorId : null)),
    ).toEqual(['crossing']);
  });

  it('pins active and upcoming maintenances for the all-events timeline', () => {
    const monthStart = new Date('2026-06-01T00:00:00.000Z');
    const monthEnd = new Date('2026-07-01T00:00:00.000Z');

    const result = projectTimeline({
      state: createState(),
      monitors: [publicMonitor('api', 'API')],
      maintenances: [
        maintenance('active', '2026-06-10T11:00:00.000Z', '2026-06-10T13:00:00.000Z', ['api']),
        maintenance('past', '2026-06-03T00:00:00.000Z', '2026-06-03T01:00:00.000Z'),
      ],
      monthStart,
      monthEnd,
      nowMs: Date.parse('2026-06-10T12:00:00.000Z'),
      eventType: 'all',
    });

    expect(result.pinned.map((event) => event.maintenance.id)).toEqual(['active']);
    expect(
      result.timeline.map((event) => event.type === 'maintenance' && event.maintenance.id),
    ).toEqual(['past']);
  });

  it('filters timeline events by selected monitor', () => {
    const monthStart = new Date('2026-06-01T00:00:00.000Z');
    const monthEnd = new Date('2026-07-01T00:00:00.000Z');
    const state = createState(
      {
        api: {
          incidents: [
            {
              start: [Date.parse('2026-06-05T10:00:00.000Z') / 1000],
              end: Date.parse('2026-06-05T10:30:00.000Z') / 1000,
              error: ['API error'],
            },
          ],
        },
        web: {
          incidents: [
            {
              start: [Date.parse('2026-06-04T10:00:00.000Z') / 1000],
              end: Date.parse('2026-06-04T10:30:00.000Z') / 1000,
              error: ['Web error'],
            },
          ],
        },
      },
      Date.parse('2026-06-10T12:00:00.000Z') / 1000,
    );

    const result = projectTimeline({
      state,
      monitors: [publicMonitor('api', 'API'), publicMonitor('web', 'Web')],
      maintenances: [
        maintenance('api-maintenance', '2026-06-06T00:00:00.000Z', undefined, ['api']),
        maintenance('web-maintenance', '2026-06-07T00:00:00.000Z', undefined, ['web']),
        maintenance('site-wide', '2026-06-08T00:00:00.000Z'),
      ],
      monthStart,
      monthEnd,
      nowMs: Date.parse('2026-06-10T12:00:00.000Z'),
      selectedMonitor: 'api',
      eventType: 'all',
    });

    expect(result.pinned.map((event) => event.maintenance.id)).toEqual([
      'site-wide',
      'api-maintenance',
    ]);
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]).toMatchObject({ type: 'incident', monitorId: 'api' });
  });

  it('does not pin active maintenance when filtering to maintenance events', () => {
    const monthStart = new Date('2026-06-01T00:00:00.000Z');
    const monthEnd = new Date('2026-07-01T00:00:00.000Z');

    const result = projectTimeline({
      state: createState(),
      monitors: [publicMonitor('api', 'API')],
      maintenances: [
        maintenance('active', '2026-06-10T11:00:00.000Z', '2026-06-10T13:00:00.000Z', ['api']),
      ],
      monthStart,
      monthEnd,
      nowMs: Date.parse('2026-06-10T12:00:00.000Z'),
      eventType: 'maintenance',
    });

    expect(result.pinned).toEqual([]);
    expect(
      result.timeline.map((event) => event.type === 'maintenance' && event.maintenance.id),
    ).toEqual(['active']);
  });

  it('lists each run of a repeating window in its month and pins only the current one', () => {
    const weekly: Maintenance = {
      ...maintenance('weekly', '2026-05-04T02:00:00.000Z', '2026-05-04T03:00:00.000Z'),
      repeat: { every: 'week' },
    };

    const result = projectTimeline({
      state: createState(),
      monitors: [publicMonitor('api', 'API')],
      maintenances: [weekly],
      monthStart: new Date('2026-06-01T00:00:00.000Z'),
      monthEnd: new Date('2026-06-30T23:59:59.999Z'),
      nowMs: Date.parse('2026-06-15T02:30:00.000Z'),
      eventType: 'all',
    });

    const starts = (events: typeof result.timeline) =>
      events.map((event) =>
        event.type === 'maintenance' ? new Date(event.occurrence.start).toISOString() : null,
      );
    expect(starts(result.pinned)).toEqual(['2026-06-15T02:00:00.000Z']);
    expect(starts(result.timeline)).toEqual([
      '2026-06-29T02:00:00.000Z',
      '2026-06-22T02:00:00.000Z',
      '2026-06-08T02:00:00.000Z',
      '2026-06-01T02:00:00.000Z',
    ]);
  });

  it('lists past runs and only the next one when the range has no real end', () => {
    const daily: Maintenance = {
      ...maintenance('daily', '2026-06-01T10:00:00.000Z', '2026-06-01T11:00:00.000Z'),
      repeat: { every: 'day' },
    };
    const later = maintenance('later', '2026-09-01T00:00:00.000Z', '2026-09-01T01:00:00.000Z');

    const result = projectTimeline({
      state: createState(),
      monitors: [publicMonitor('api', 'API')],
      maintenances: [daily, later],
      monthStart: new Date('2026-03-12T12:00:00.000Z'),
      monthEnd: new Date(8.64e15),
      nowMs: Date.parse('2026-06-10T12:00:00.000Z'),
      eventType: 'all',
      nextRunOnly: true,
    });

    const runs = [...result.pinned, ...result.timeline].map((event) =>
      event.type === 'maintenance'
        ? `${event.maintenance.id} ${new Date(event.occurrence.start).toISOString()}`
        : null,
    );
    expect(runs.slice(0, 3)).toEqual([
      'daily 2026-06-11T10:00:00.000Z',
      'later 2026-09-01T00:00:00.000Z',
      'daily 2026-06-10T10:00:00.000Z',
    ]);
    expect(runs.at(-1)).toBe('daily 2026-06-01T10:00:00.000Z');
    expect(runs).toHaveLength(12);
  });

  it('projects a repeating window with an unknown zone as UTC instead of throwing', () => {
    const unknownZone: Maintenance = {
      ...maintenance('mars', '2026-06-01T10:00:00.000Z', '2026-06-01T11:00:00.000Z'),
      repeat: { every: 'week', timeZone: 'Mars/Olympus' },
    };

    const result = projectTimeline({
      state: createState(),
      monitors: [publicMonitor('api', 'API')],
      maintenances: [unknownZone],
      monthStart: new Date('2026-06-01T00:00:00.000Z'),
      monthEnd: new Date('2026-06-14T23:59:59.999Z'),
      nowMs: Date.parse('2026-06-20T00:00:00.000Z'),
      eventType: 'all',
    });

    expect(
      result.timeline.map((event) =>
        event.type === 'maintenance' ? new Date(event.occurrence.start).toISOString() : null,
      ),
    ).toEqual(['2026-06-08T10:00:00.000Z', '2026-06-01T10:00:00.000Z']);
  });
});

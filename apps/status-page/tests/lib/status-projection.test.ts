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
      projectPublicData([publicMonitor('api', 'API'), publicMonitor('web', 'Web')], state),
    ).toEqual({
      up: 1,
      down: 1,
      updatedAt: 1_789_000_000,
      monitors: {
        api: {
          up: true,
          latency: 42,
          location: 'SFO',
          message: 'OK',
        },
        web: {
          up: false,
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

    expect(projectPublicData([publicMonitor('web', 'Web')], state)).toEqual({
      up: 0,
      down: 1,
      updatedAt: 1_789_000_000,
      monitors: {
        web: {
          up: false,
          latency: null,
          location: null,
          message: 'Unknown error',
        },
      },
    });
  });

  it('counts late, pending and running jobs as up in public data', () => {
    const state = createState({
      api: { status: 'up' },
      late: { status: 'late' },
      pending: { status: 'pending' },
      running: { status: 'running' },
      web: { status: 'down', incidents: [{ start: [1_788_999_000], error: ['Timeout'] }] },
    });

    expect(
      projectPublicData(
        ['api', 'late', 'pending', 'running', 'web'].map((id) => publicMonitor(id)),
        state,
      ),
    ).toMatchObject({ up: 4, down: 1 });
  });

  it('projects badge status as unknown when the monitor has no state', () => {
    expect(projectBadgeStatus('api', createState())).toEqual({ status: 'unknown' });
  });

  it('projects badge status as unknown until the monitor has its first check result', () => {
    const state = createState({ api: { status: 'up' } });

    expect(projectBadgeStatus('api', state)).toEqual({ status: 'unknown' });
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

    expect(projectBadgeStatus('api', state)).toEqual({ status: 'known', up: false });
    expect(projectBadgeStatus('web', state)).toEqual({ status: 'known', up: true });
  });

  it('projects a heartbeat badge from heartbeat state, which carries no latency', () => {
    const incidents = [{ start: [1_788_999_000], end: 1_789_000_000, error: ['Late'] }];

    expect(
      projectBadgeStatus(
        'job',
        createState({
          job: { status: 'up', startedAt: 1_788_999_000, incidents, heartbeat: { status: 'up' } },
        }),
      ),
    ).toEqual({ status: 'known', up: true });
    expect(
      projectBadgeStatus(
        'job',
        createState({ job: { status: 'pending', incidents, heartbeat: { status: 'pending' } } }),
      ),
    ).toEqual({ status: 'unknown' });
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
});

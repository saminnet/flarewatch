import { describe, expect, it } from 'vite-plus/test';
import type { Maintenance, MonitorState, MonitorTarget } from '@flarewatch/shared';
import type { PublicMonitor } from '../../src/lib/monitors';
import {
  projectBadgeStatus,
  projectPublicData,
  projectTimeline,
} from '../../src/lib/status-projection';

function createState(overrides: Partial<MonitorState> = {}): MonitorState {
  return {
    incident: {},
    latency: {},
    overallUp: 0,
    overallDown: 0,
    lastUpdate: 1_789_000_000,
    startedAt: {},
    ...overrides,
  };
}

function monitor(id: string, name = id): MonitorTarget {
  return {
    id,
    name,
    method: 'GET',
    target: `https://${id}.example.com`,
  };
}

function publicMonitor(id: string, name = id): PublicMonitor {
  return { id, name };
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
      overallUp: 5,
      overallDown: 1,
      incident: {
        api: [],
        web: [{ start: [1_788_999_000], end: undefined, error: ['Timeout'] }],
      },
      latency: {
        api: { recent: [{ loc: 'SFO', ping: 42, time: 1_789_000_000 }] },
        web: { recent: [{ loc: 'FRA', ping: 120, time: 1_789_000_000 }] },
      },
    });

    expect(projectPublicData([monitor('api', 'API'), monitor('web', 'Web')], state)).toEqual({
      up: 5,
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
      overallUp: 0,
      overallDown: 1,
      incident: {
        web: [{ start: [1_788_999_000], end: undefined, error: [] }],
      },
      latency: {},
    });

    expect(projectPublicData([monitor('web', 'Web')], state)).toEqual({
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

  it('projects badge status as unknown when the monitor has no state', () => {
    expect(projectBadgeStatus('api', createState())).toEqual({ status: 'unknown' });
  });

  it('projects badge status as unknown until a monitor has state and latency', () => {
    const state = createState({
      incident: { api: [] },
      latency: { api: { recent: [] } },
    });

    expect(projectBadgeStatus('api', state)).toEqual({ status: 'unknown' });
  });

  it('projects badge status as known when monitor state is ready', () => {
    const state = createState({
      incident: {
        api: [{ start: [1_788_999_000], end: undefined, error: ['Down'] }],
      },
      latency: {
        api: { recent: [{ loc: 'SFO', ping: 42, time: 1_789_000_000 }] },
      },
    });

    expect(projectBadgeStatus('api', state)).toEqual({ status: 'known', up: false });
  });

  it('orders incident and maintenance timeline events by start descending', () => {
    const monthStart = new Date('2026-06-01T00:00:00.000Z');
    const monthEnd = new Date('2026-07-01T00:00:00.000Z');
    const state = createState({
      lastUpdate: Date.parse('2026-06-10T12:00:00.000Z') / 1000,
      incident: {
        api: [
          {
            start: [Date.parse('2026-06-05T10:00:00.000Z') / 1000],
            end: Date.parse('2026-06-05T10:30:00.000Z') / 1000,
            error: ['API error'],
          },
        ],
        web: [
          {
            start: [Date.parse('2026-06-07T10:00:00.000Z') / 1000],
            end: Date.parse('2026-06-07T10:30:00.000Z') / 1000,
            error: ['Web error'],
          },
        ],
      },
      latency: {},
    });

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

  it('uses the provided now for open incidents when state has no last update', () => {
    const monthStart = new Date('2026-06-01T00:00:00.000Z');
    const monthEnd = new Date('2026-07-01T00:00:00.000Z');
    const state = createState({
      lastUpdate: 0,
      incident: {
        api: [
          {
            start: [Date.parse('2026-06-05T10:00:00.000Z') / 1000],
            end: undefined,
            error: ['Still down'],
          },
        ],
      },
      latency: {},
    });

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
      end: undefined,
    });
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
    const state = createState({
      lastUpdate: Date.parse('2026-06-10T12:00:00.000Z') / 1000,
      incident: {
        api: [
          {
            start: [Date.parse('2026-06-05T10:00:00.000Z') / 1000],
            end: Date.parse('2026-06-05T10:30:00.000Z') / 1000,
            error: ['API error'],
          },
        ],
        web: [
          {
            start: [Date.parse('2026-06-04T10:00:00.000Z') / 1000],
            end: Date.parse('2026-06-04T10:30:00.000Z') / 1000,
            error: ['Web error'],
          },
        ],
      },
      latency: {},
    });

    const result = projectTimeline({
      state,
      monitors: [publicMonitor('api', 'API'), publicMonitor('web', 'Web')],
      maintenances: [
        maintenance('api-maintenance', '2026-06-06T00:00:00.000Z', undefined, ['api']),
        maintenance('web-maintenance', '2026-06-07T00:00:00.000Z', undefined, ['web']),
      ],
      monthStart,
      monthEnd,
      nowMs: Date.parse('2026-06-10T12:00:00.000Z'),
      selectedMonitor: 'api',
      eventType: 'all',
    });

    expect(result.pinned.map((event) => event.maintenance.id)).toEqual(['api-maintenance']);
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

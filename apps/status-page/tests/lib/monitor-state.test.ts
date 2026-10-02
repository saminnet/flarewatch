import { describe, expect, it } from 'vite-plus/test';
import type { Maintenance, MonitorView, StatusView } from '@flarewatch/shared';
import type { PublicMonitor } from '@/lib/public-view';
import {
  countStatuses,
  getOverallStatus,
  monitorState,
  type MonitorState,
  type StatusCounts,
} from '@/lib/monitor-state';

const check: PublicMonitor = { id: 'm', name: 'M', method: 'GET' };
const capped: PublicMonitor = { ...check, maxLatencyMs: 500 };
const job: PublicMonitor = { id: 'm', name: 'M', method: 'HEARTBEAT' };

const SAMPLE_AT = 3000;
const OPEN = { start: [1000], error: ['Error'] };
const CLOSED = { start: [1000], end: 2000, error: ['Error'] };
const latest = (ping: number) => ({ latest: { loc: 'FRA', ping, time: SAMPLE_AT } });

function window(start: number, end?: number, monitors?: string[]): Maintenance {
  return {
    id: `w${start}`,
    start: new Date(start * 1000).toISOString(),
    ...(end !== undefined && { end: new Date(end * 1000).toISOString() }),
    ...(monitors && { monitors }),
    body: 'Planned work',
    createdAt: 0,
    updatedAt: 0,
  };
}

function stateOf(view?: Partial<MonitorView>): StatusView {
  return {
    lastUpdate: SAMPLE_AT,
    monitors: view ? { m: { status: 'up', incidents: [], ...view } } : {},
  };
}

type Case = [string, PublicMonitor, Partial<MonitorView> | undefined, MonitorState, Maintenance[]?];

const cases: Case[] = [
  ['a check with no incidents is up', check, { status: 'up' }, 'up'],
  ['a check whose last incident closed is up', check, { incidents: [CLOSED] }, 'up'],
  ['a check with an open incident is down', check, { status: 'down', incidents: [OPEN] }, 'down'],
  ['a check the hub has no data for is pending', check, undefined, 'pending'],
  ['a job on time is up', job, { heartbeat: { status: 'up' } }, 'up'],
  ['a late job is degraded', job, { status: 'late', heartbeat: { status: 'late' } }, 'degraded'],
  [
    'a pending job is pending',
    job,
    { status: 'pending', heartbeat: { status: 'pending' } },
    'pending',
  ],
  [
    'a running job is running',
    job,
    { status: 'running', heartbeat: { status: 'running' } },
    'running',
  ],
  ['a job that never pinged is pending', job, { status: 'up' }, 'pending'],
  ['a job the hub has no data for is pending', job, undefined, 'pending'],
  [
    'a job that failed is down',
    job,
    { status: 'down', incidents: [OPEN], heartbeat: { status: 'down' } },
    'down',
  ],
  [
    'a job running again while its incident is open is down',
    job,
    { status: 'down', incidents: [OPEN], heartbeat: { status: 'running' } },
    'down',
  ],
  [
    'a job with an open incident and no signal is down',
    job,
    { status: 'down', incidents: [OPEN] },
    'down',
  ],
  ['a check slower than its maxLatencyMs is degraded', capped, latest(501), 'degraded'],
  ['a check exactly at its maxLatencyMs is up', capped, latest(500), 'up'],
  ['a check faster than its maxLatencyMs is up', capped, latest(120), 'up'],
  ['a slow check without maxLatencyMs is up', check, latest(9000), 'up'],
  ['a check with maxLatencyMs and no sample is up', capped, {}, 'up'],
  [
    'a slow check with an open incident is down',
    capped,
    { status: 'down', incidents: [OPEN], ...latest(9000) },
    'down',
  ],
  [
    'a slow check inside a maintenance window that covers it is up',
    capped,
    latest(9000),
    'up',
    [window(SAMPLE_AT - 60, SAMPLE_AT + 60, ['m'])],
  ],
  [
    'a slow check inside a window that covers every monitor is up',
    capped,
    latest(9000),
    'up',
    [window(SAMPLE_AT - 60)],
  ],
  [
    'a slow check inside a window for another monitor is degraded',
    capped,
    latest(9000),
    'degraded',
    [window(SAMPLE_AT - 60, SAMPLE_AT + 60, ['other'])],
  ],
  [
    'a slow check after its maintenance window ended is degraded',
    capped,
    latest(9000),
    'degraded',
    [window(SAMPLE_AT - 120, SAMPLE_AT - 60, ['m'])],
  ],
  [
    'a slow check before its maintenance window starts is degraded',
    capped,
    latest(9000),
    'degraded',
    [window(SAMPLE_AT + 60, undefined, ['m'])],
  ],
];

describe('monitorState', () => {
  it.each(cases)('%s', (_name, monitor, view, expected, maintenances = []) => {
    expect(monitorState(monitor, stateOf(view), maintenances)).toBe(expected);
  });
});

describe('countStatuses', () => {
  it('counts late jobs and slow checks apart, pending and running as up, and skips monitors without data', () => {
    const monitors: PublicMonitor[] = [
      { id: 'up', name: 'Up', method: 'GET' },
      { id: 'pending', name: 'Pending', method: 'HEARTBEAT' },
      { id: 'running', name: 'Running', method: 'HEARTBEAT' },
      { id: 'late', name: 'Late', method: 'HEARTBEAT' },
      { id: 'slow', name: 'Slow', method: 'GET', maxLatencyMs: 500 },
      { id: 'down', name: 'Down', method: 'GET' },
      { id: 'down2', name: 'Down 2', method: 'GET', maxLatencyMs: 500 },
      { id: 'unseen', name: 'Unseen', method: 'GET' },
    ];
    const state: StatusView = {
      lastUpdate: SAMPLE_AT,
      monitors: {
        up: { status: 'up', incidents: [] },
        pending: { status: 'pending', incidents: [], heartbeat: { status: 'pending' } },
        running: { status: 'running', incidents: [], heartbeat: { status: 'running' } },
        late: { status: 'late', incidents: [], heartbeat: { status: 'late' } },
        slow: { status: 'up', incidents: [], ...latest(900) },
        down: { status: 'down', incidents: [OPEN] },
        down2: { status: 'down', incidents: [OPEN], ...latest(900) },
      },
    };

    expect(countStatuses(monitors, state, [])).toEqual({ up: 3, late: 1, slow: 1, down: 2 });
  });
});

describe('getOverallStatus', () => {
  const overall: Array<[string, StatusCounts, ReturnType<typeof getOverallStatus>]> = [
    ['operational when all monitors are up', { up: 3, late: 0, slow: 0, down: 0 }, 'operational'],
    [
      'degraded when a job is late and none are down',
      { up: 3, late: 1, slow: 0, down: 0 },
      'degraded',
    ],
    [
      'degraded when a check is slow and none are down',
      { up: 3, late: 0, slow: 1, down: 0 },
      'degraded',
    ],
    ['degraded when some monitors are down', { up: 2, late: 0, slow: 0, down: 1 }, 'degraded'],
    [
      'degraded when the only monitors not down are late',
      { up: 0, late: 1, slow: 0, down: 2 },
      'degraded',
    ],
    [
      'degraded when the only monitors not down are slow',
      { up: 0, late: 0, slow: 1, down: 2 },
      'degraded',
    ],
    ['down when all monitors are down', { up: 0, late: 0, slow: 0, down: 3 }, 'down'],
  ];

  it.each(overall)('is %s', (_name, counts, expected) => {
    expect(getOverallStatus(counts)).toBe(expected);
  });
});

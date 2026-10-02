import { describe, expect, it } from 'vite-plus/test';
import type { Maintenance, RuntimeConfig, StatusView } from '@flarewatch/shared';
import {
  operatorSnapshot,
  publicMaintenances,
  publicView,
  toAdminMonitors,
  visitorSnapshot,
} from '@/lib/public-view';
import { countStatuses } from '@/lib/monitor-state';

const config: RuntimeConfig = {
  monitors: [
    {
      id: 'public',
      name: 'Public monitor',
      method: 'GET',
      target: 'https://public.example.com',
      headers: { Authorization: 'secret' },
      body: 'secret body',
      checkProxy: 'https://token@example.com',
      expectedCodes: [200],
      responseKeyword: 'secret response',
    },
    {
      id: 'hidden',
      name: 'Hidden monitor',
      method: 'GET',
      target: 'https://hidden.example.com',
      private: true,
    },
    {
      id: 'job',
      name: 'Nightly job',
      method: 'HEARTBEAT',
      periodSeconds: 86_400,
      graceSeconds: 1800,
    },
    {
      id: 'hidden-job',
      name: 'Hidden job',
      method: 'HEARTBEAT',
      periodSeconds: 3600,
      graceSeconds: 300,
      private: true,
    },
  ],
  statusPage: {
    title: 'Status',
    group: {
      Services: ['public', 'removed'],
      Removed: ['removed'],
      Hidden: ['hidden'],
    },
  },
};

const state: StatusView = {
  lastUpdate: 123,
  monitors: {
    public: {
      status: 'up',
      startedAt: 100,
      incidents: [],
      latest: { loc: 'HEL', ping: 12, time: 1 },
      heartbeat: { status: 'up', lastSuccess: 110, deadline: 300 },
    },
    removed: {
      status: 'up',
      startedAt: 90,
      incidents: [],
      latest: { loc: 'FRA', ping: 34, time: 1 },
    },
    hidden: {
      status: 'late',
      startedAt: 80,
      incidents: [],
      latest: { loc: 'SFO', ping: 56, time: 1 },
      heartbeat: { status: 'late', lastSuccess: 50, deadline: 90, message: 'secret job' },
    },
    job: {
      status: 'late',
      startedAt: 100,
      incidents: [],
      heartbeat: { status: 'late', lastSuccess: 100, deadline: 130, message: 'secret job reason' },
    },
    'hidden-job': {
      status: 'down',
      startedAt: 60,
      incidents: [{ start: [60], error: ['secret job failed'] }],
      heartbeat: { status: 'down', lastFail: 60, message: 'secret job failed' },
    },
  },
};

describe('publicView', () => {
  it('carries maxLatencyMs for a check and nothing more of its config', () => {
    const view = publicView(
      {
        monitors: [
          {
            id: 'api',
            name: 'API',
            method: 'GET',
            target: 'https://api.example.com/health',
            maxLatencyMs: 800,
            headers: { Authorization: 'secret' },
            timeout: 5000,
          },
          { id: 'fast', name: 'Fast', method: 'GET', target: 'https://fast.example.com' },
        ],
      },
      null,
    );

    expect(view.monitors).toEqual([
      {
        id: 'api',
        name: 'API',
        method: 'GET',
        link: 'https://api.example.com/health',
        isProxy: false,
        maxLatencyMs: 800,
      },
      {
        id: 'fast',
        name: 'Fast',
        method: 'GET',
        link: 'https://fast.example.com/',
        isProxy: false,
      },
    ]);
    expect(view.monitors[1]).not.toHaveProperty('maxLatencyMs');
  });

  it('links to a target without its credentials or query string', () => {
    const view = publicView(
      {
        monitors: [
          {
            id: 'api',
            name: 'API',
            method: 'GET',
            target: 'https://ops:hunter2@api.example.com/health?token=abc#top',
          },
        ],
      },
      null,
    );
    expect(view.monitors[0]?.link).toBe('https://api.example.com/health');
  });

  it('projects public monitors and filters monitor-indexed config and state', () => {
    expect(publicView(config, state)).toEqual({
      monitors: [
        {
          id: 'public',
          name: 'Public monitor',
          method: 'GET',
          link: 'https://public.example.com/',
          isProxy: true,
        },
        {
          id: 'job',
          name: 'Nightly job',
          method: 'HEARTBEAT',
          isProxy: false,
          periodSeconds: 86_400,
          graceSeconds: 1800,
        },
      ],
      statusPage: {
        title: 'Status',
        group: {
          Services: ['public'],
        },
      },
      state: {
        lastUpdate: 123,
        monitors: {
          public: {
            status: 'up',
            startedAt: 100,
            incidents: [],
            latest: { loc: 'HEL', ping: 12, time: 1 },
            heartbeat: { status: 'up', lastSuccess: 110, deadline: 300 },
          },
          job: {
            status: 'late',
            startedAt: 100,
            incidents: [],
            heartbeat: { status: 'late', lastSuccess: 100, deadline: 130 },
          },
        },
      },
    });
  });

  it('keeps null state', () => {
    expect(publicView(config, null).state).toBeNull();
  });

  it('never exposes the private flag on public monitors', () => {
    const view = publicView(config, null);
    expect(view.monitors).toHaveLength(2);
    for (const monitor of view.monitors) expect(monitor).not.toHaveProperty('private');
  });
});

describe('toAdminMonitors', () => {
  it('carries the method and the private flag for every monitor', () => {
    expect(toAdminMonitors(config)).toEqual([
      {
        id: 'public',
        name: 'Public monitor',
        method: 'GET',
        link: 'https://public.example.com/',
        isProxy: true,
      },
      {
        id: 'hidden',
        name: 'Hidden monitor',
        method: 'GET',
        link: 'https://hidden.example.com/',
        isProxy: false,
        private: true,
      },
      {
        id: 'job',
        name: 'Nightly job',
        method: 'HEARTBEAT',
        isProxy: false,
        periodSeconds: 86_400,
        graceSeconds: 1800,
      },
      {
        id: 'hidden-job',
        name: 'Hidden job',
        method: 'HEARTBEAT',
        isProxy: false,
        periodSeconds: 3600,
        graceSeconds: 300,
        private: true,
      },
    ]);
  });
});

describe('publicMaintenances', () => {
  const maintenance = (overrides: Partial<Maintenance>): Maintenance => ({
    id: 'maintenance',
    body: 'Maintenance',
    start: '2026-01-01T00:00:00.000Z',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  });

  it('strips private monitor ids from scoped records', () => {
    expect(
      publicMaintenances(config, [maintenance({ id: 'mixed', monitors: ['public', 'hidden'] })]),
    ).toEqual([maintenance({ id: 'mixed', monitors: ['public'] })]);
  });

  it('drops records whose monitors are all private but keeps unscoped ones', () => {
    expect(
      publicMaintenances(config, [
        maintenance({ id: 'unscoped' }),
        maintenance({ id: 'empty', monitors: [] }),
        maintenance({ id: 'all-private', monitors: ['hidden'] }),
      ]),
    ).toEqual([maintenance({ id: 'unscoped' }), maintenance({ id: 'empty', monitors: [] })]);
  });
});

describe('snapshots', () => {
  const maintenances: Maintenance[] = [
    {
      id: 'private-only',
      title: 'Hidden job upgrade',
      body: 'Hidden job upgrade',
      start: '2026-01-01T00:00:00.000Z',
      monitors: ['hidden-job'],
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: 'mixed',
      body: 'Network work',
      start: '2026-01-02T00:00:00.000Z',
      monitors: ['public', 'hidden'],
      createdAt: 0,
      updatedAt: 0,
    },
  ];

  it('leaks nothing about private monitors to visitors', () => {
    const serialized = JSON.stringify(visitorSnapshot(config, state, maintenances));

    for (const secret of [
      'hidden',
      'Hidden monitor',
      'Hidden job',
      'Hidden',
      'secret job',
      'secret job reason',
      'private',
      'secret body',
      'secret response',
      'token@example.com',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('gives visitors the published monitors, their groups and their maintenance', () => {
    const snapshot = visitorSnapshot(config, state, maintenances);

    expect(snapshot.monitors.map((monitor) => monitor.id)).toEqual(['public', 'job']);
    expect(snapshot.groups).toEqual({ Services: ['public'] });
    expect(snapshot.maintenances.map(({ id, monitors }) => ({ id, monitors }))).toEqual([
      { id: 'mixed', monitors: ['public'] },
    ]);
  });

  it('gives the operator every monitor, failure message and maintenance window', () => {
    const snapshot = operatorSnapshot(config, state, maintenances);

    expect(snapshot.monitors.map((monitor) => monitor.id)).toEqual([
      'public',
      'hidden',
      'job',
      'hidden-job',
    ]);
    expect(snapshot.groups).toEqual({ Services: ['public'], Hidden: ['hidden'] });
    expect(Object.keys(snapshot.state?.monitors ?? {}).sort()).toEqual([
      'hidden',
      'hidden-job',
      'job',
      'public',
    ]);
    expect(snapshot.state?.monitors['hidden-job']?.heartbeat?.message).toBe('secret job failed');
    expect(snapshot.maintenances).toEqual(maintenances);
  });

  it('counts every configured monitor for the operator, published only for visitors', () => {
    const counted: StatusView = {
      lastUpdate: 123,
      monitors: {
        public: {
          status: 'up',
          startedAt: 100,
          incidents: [{ start: [100], end: 110, error: ['recovered'] }],
        },
        hidden: {
          status: 'down',
          startedAt: 100,
          incidents: [{ start: [110], error: ['still failing'] }],
        },
        job: {
          status: 'late',
          startedAt: 100,
          incidents: [],
          heartbeat: { status: 'late', lastSuccess: 100, deadline: 130 },
        },
        removed: {
          status: 'down',
          startedAt: 100,
          incidents: [{ start: [110], error: ['no longer configured'] }],
        },
      },
    };

    const operator = operatorSnapshot(config, counted, []);
    const visitor = visitorSnapshot(config, counted, []);
    expect(countStatuses(operator.monitors, operator.state!, [])).toEqual({
      up: 1,
      late: 1,
      slow: 0,
      down: 1,
    });
    expect(countStatuses(visitor.monitors, visitor.state!, [])).toEqual({
      up: 1,
      late: 1,
      slow: 0,
      down: 0,
    });
  });
});

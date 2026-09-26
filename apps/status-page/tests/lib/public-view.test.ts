import { describe, expect, it } from 'vite-plus/test';
import type { Maintenance, MonitorState, RuntimeConfig } from '@flarewatch/shared';
import {
  operatorSnapshot,
  publicMaintenances,
  publicView,
  toAdminMonitors,
  visitorSnapshot,
} from '@/lib/public-view';

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

const state: MonitorState = {
  incident: { public: [], removed: [], hidden: [] },
  latency: {
    public: { recent: [{ loc: 'HEL', ping: 12, time: 1 }] },
    removed: { recent: [{ loc: 'FRA', ping: 34, time: 1 }] },
    hidden: { recent: [{ loc: 'SFO', ping: 56, time: 1 }] },
  },
  overallUp: 7,
  overallDown: 2,
  lastUpdate: 123,
  startedAt: { public: 100, removed: 90, hidden: 80 },
  sslCertificates: {
    public: { expiryDate: 200, daysUntilExpiry: 30, lastCheck: 120 },
    removed: { expiryDate: 180, daysUntilExpiry: 10, lastCheck: 110 },
    hidden: { expiryDate: 160, daysUntilExpiry: 5, lastCheck: 100 },
  },
  heartbeat: {
    public: { status: 'up', lastSuccess: 110, deadline: 300 },
    job: { status: 'late', lastSuccess: 100, deadline: 130, message: 'secret job reason' },
    hidden: { status: 'late', lastSuccess: 50, deadline: 90, message: 'secret job' },
    'hidden-job': { status: 'down', lastFail: 60, message: 'secret job failed' },
  },
};

describe('publicView', () => {
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
        incident: { public: [] },
        latency: {
          public: { recent: [{ loc: 'HEL', ping: 12, time: 1 }] },
        },
        overallUp: 7,
        overallDown: 2,
        lastUpdate: 123,
        startedAt: { public: 100 },
        sslCertificates: {
          public: { expiryDate: 200, daysUntilExpiry: 30, lastCheck: 120 },
        },
        heartbeat: {
          public: { status: 'up', lastSuccess: 110, deadline: 300 },
          job: { status: 'late', lastSuccess: 100, deadline: 130 },
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
    expect(snapshot.state?.heartbeat?.['hidden-job']?.message).toBe('secret job failed');
    expect(snapshot.maintenances).toEqual(maintenances);
  });
});

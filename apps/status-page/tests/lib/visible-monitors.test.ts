import { describe, expect, it } from 'vite-plus/test';
import type { RuntimeConfig, StatusView } from '@flarewatch/shared';
import { canReadLatency, memberSnapshot, visibleMonitorIds } from '@/lib/public-view';

const config: RuntimeConfig = {
  monitors: [
    { id: 'api', name: 'API', method: 'GET', target: 'https://api.example.com' },
    { id: 'db', name: 'DB', method: 'TCP_PING', target: 'db.internal:5432', private: true },
    {
      id: 'acme-db',
      name: 'Acme DB',
      method: 'TCP_PING',
      target: 'acme.internal:5432',
      private: true,
    },
    {
      id: 'backup',
      name: 'Backup',
      method: 'HEARTBEAT',
      periodSeconds: 60,
      graceSeconds: 10,
      private: true,
    },
  ],
  statusPage: { group: { Acme: ['acme-db', 'removed'], Jobs: ['backup'] } },
};

const sorted = (ids: Set<string>) => [...ids].sort();

describe('visibleMonitorIds', () => {
  it('shows visitors the published monitors only', () => {
    expect(sorted(visibleMonitorIds(config, null))).toEqual(['api']);
  });

  it('adds an audience member their page groups, skipping ids not in config', () => {
    expect(sorted(visibleMonitorIds(config, { role: 'member', groups: ['Acme'] }))).toEqual([
      'acme-db',
      'api',
    ]);
  });

  it('shows the operator and members without groups every monitor', () => {
    const all = ['acme-db', 'api', 'backup', 'db'];
    expect(sorted(visibleMonitorIds(config, { role: 'operator' }))).toEqual(all);
    expect(sorted(visibleMonitorIds(config, { role: 'member', groups: 'all' }))).toEqual(all);
  });
});

describe('canReadLatency', () => {
  it('follows what the person may see, and never serves a job', () => {
    expect(canReadLatency(config, 'api', null)).toBe(true);
    expect(canReadLatency(config, 'db', null)).toBe(false);
    expect(canReadLatency(config, 'acme-db', { role: 'member', groups: ['Acme'] })).toBe(true);
    expect(canReadLatency(config, 'db', { role: 'member', groups: ['Acme'] })).toBe(false);
    expect(canReadLatency(config, 'backup', { role: 'operator' })).toBe(false);
    expect(canReadLatency(config, 'ghost', { role: 'operator' })).toBe(false);
  });
});

describe('memberSnapshot', () => {
  const state: StatusView = {
    lastUpdate: 100,
    monitors: {
      'acme-db': { status: 'down', incidents: [{ start: [50], error: ['refused'] }] },
      db: { status: 'up', incidents: [] },
      backup: {
        status: 'down',
        incidents: [],
        heartbeat: { status: 'down', lastFail: 90, message: 'disk full' },
      },
    },
  };
  const maintenances = [
    { id: 'm1', body: 'b', start: 0, createdAt: 0, updatedAt: 0, monitors: ['db', 'acme-db'] },
    { id: 'm2', body: 'b', start: 0, createdAt: 0, updatedAt: 0, monitors: ['db'] },
  ];

  it('gives an audience its groups and nothing of the other private monitors', () => {
    const snapshot = memberSnapshot(config, state, maintenances, {
      role: 'member',
      groups: ['Acme'],
    });

    expect(snapshot.monitors.map((monitor) => monitor.id)).toEqual(['api', 'acme-db']);
    expect(snapshot.groups).toEqual({ Acme: ['acme-db'] });
    expect(Object.keys(snapshot.state?.monitors ?? {})).toEqual(['acme-db']);
    expect(snapshot.maintenances).toEqual([{ ...maintenances[0], monitors: ['acme-db'] }]);
  });

  it('keeps job failure messages for members who see everything, and only for them', () => {
    const everything = memberSnapshot(config, state, [], { role: 'member', groups: 'all' });
    const jobsOnly = memberSnapshot(config, state, [], { role: 'member', groups: ['Jobs'] });

    expect(everything.state?.monitors.backup?.heartbeat?.message).toBe('disk full');
    expect(jobsOnly.state?.monitors.backup?.heartbeat).not.toHaveProperty('message');
  });
});

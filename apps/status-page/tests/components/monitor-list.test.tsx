// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { AdminMonitor } from '@/lib/public-view';
import { renderWithProviders } from '../helpers/render';
import type { StatusView } from '@flarewatch/shared';

// jsdom has no ResizeObserver; the card body only measures its container width.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const { MonitorList } = await import('@/components/monitor-list');

afterEach(cleanup);

const state: StatusView = { lastUpdate: 0, monitors: {} };

const heartbeatMonitors: AdminMonitor[] = [
  { id: 'job_a', name: 'Job A', method: 'HEARTBEAT', periodSeconds: 3600, graceSeconds: 60 },
  { id: 'job_b', name: 'Job B', method: 'HEARTBEAT', periodSeconds: 60, graceSeconds: 0 },
];

describe('MonitorList', () => {
  it('renders every card when the page has only heartbeats and no groups', () => {
    renderWithProviders(<MonitorList monitors={heartbeatMonitors} state={state} />);

    expect(screen.getByText('Job A')).toBeTruthy();
    expect(screen.getByText('Job B')).toBeTruthy();
    expect(screen.queryByText('Scheduled jobs')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Filter monitors by kind' })).toBeNull();
  });

  it('counts only the days a young monitor has been watched in the row label', () => {
    const lastUpdate = Date.parse('2025-01-15T12:00:00Z') / 1000;
    const startedAt = Date.parse('2024-12-23T12:00:00Z') / 1000;
    const outage = Date.parse('2025-01-10T08:00:00Z') / 1000;
    const young: StatusView = {
      lastUpdate,
      monitors: {
        quiet: { status: 'up', startedAt, incidents: [] },
        flaky: {
          status: 'up',
          startedAt,
          incidents: [{ start: [outage], end: outage + 3600, error: ['HTTP 503'] }],
        },
      },
    };
    const monitors: AdminMonitor[] = [
      { id: 'quiet', name: 'Quiet', method: 'GET' },
      { id: 'flaky', name: 'Flaky', method: 'GET' },
    ];

    renderWithProviders(<MonitorList monitors={monitors} state={young} />);

    expect(
      screen.getByRole('link', { name: /^Quiet, .*, no downtime in the last 24 days$/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /^Flaky, .*, downtime on 1 of the last 24 days$/ }),
    ).toBeTruthy();
  });
});

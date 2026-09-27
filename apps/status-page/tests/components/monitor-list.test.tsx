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
});

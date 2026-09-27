// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import type { HeartbeatStatus, StatusView } from '@flarewatch/shared';
import { OverallStatus } from '@/components/overall-status';
import { renderWithProviders } from '../helpers/render';

afterEach(cleanup);

function state(statuses: HeartbeatStatus[]): StatusView {
  return {
    lastUpdate: Math.floor(Date.now() / 1000),
    monitors: Object.fromEntries(
      statuses.map((status, i) => [
        `m${i}`,
        {
          status,
          incidents: status === 'down' ? [{ start: [1000], error: ['Error'] }] : [],
        },
      ]),
    ),
  };
}

describe('OverallStatus', () => {
  it('reports all operational when nothing is down or late', () => {
    renderWithProviders(
      <OverallStatus state={state(['up', 'up', 'up'])} monitorCount={3} jobCount={3} />,
    );

    expect(screen.getByRole('heading').textContent).toBe('All systems operational');
    expect(screen.getByText('3 up / 0 down')).toBeTruthy();
  });

  it('raises the degraded banner for a late heartbeat with nothing down', () => {
    const { container } = renderWithProviders(
      <OverallStatus
        state={state(['up', 'up', 'up', 'up', 'late'])}
        monitorCount={5}
        jobCount={2}
      />,
    );

    expect(screen.getByRole('heading').textContent).toBe('Some jobs are running late (1 out of 2)');
    expect(container.querySelector('.bg-status-degraded-bg')).not.toBeNull();
  });

  it('splits late out of the up count and counts every visible monitor', () => {
    renderWithProviders(
      <OverallStatus
        state={state(['up', 'pending', 'running', 'late', 'down'])}
        monitorCount={5}
        jobCount={2}
      />,
    );

    expect(screen.getByRole('heading').textContent).toBe('Some systems are down (1 out of 5)');
    expect(screen.getByText('3 up / 1 late / 1 down')).toBeTruthy();
  });
});

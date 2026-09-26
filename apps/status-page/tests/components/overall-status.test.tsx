// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import type { MonitorState } from '@flarewatch/shared';
import '@/lib/i18n';
import { OverallStatus } from '@/components/overall-status';
import { renderWithProviders } from '../helpers/render';

afterEach(cleanup);

function state(overrides: Partial<MonitorState>): MonitorState {
  return {
    lastUpdate: Math.floor(Date.now() / 1000),
    overallUp: 3,
    overallDown: 0,
    startedAt: {},
    incident: {},
    latency: {},
    ...overrides,
  };
}

describe('OverallStatus', () => {
  it('reports all operational when nothing is down or late', () => {
    renderWithProviders(<OverallStatus state={state({})} monitorCount={3} jobCount={3} />);

    expect(screen.getByRole('heading').textContent).toBe('All systems operational');
    expect(screen.getByText('3 up / 0 down')).toBeTruthy();
  });

  it('raises the degraded banner for a late heartbeat with nothing down', () => {
    const { container } = renderWithProviders(
      <OverallStatus state={state({ overallLate: 1 })} monitorCount={5} jobCount={2} />,
    );

    expect(screen.getByRole('heading').textContent).toBe('Some jobs are running late (1 out of 2)');
    expect(container.querySelector('.bg-status-degraded-bg')).not.toBeNull();
  });

  it('splits late out of the up count and counts every visible monitor', () => {
    renderWithProviders(
      <OverallStatus
        state={state({ overallUp: 2, overallDown: 1, overallLate: 1 })}
        monitorCount={5}
        jobCount={2}
      />,
    );

    expect(screen.getByRole('heading').textContent).toBe('Some systems are down (1 out of 5)');
    expect(screen.getByText('1 up / 1 late / 1 down')).toBeTruthy();
  });
});

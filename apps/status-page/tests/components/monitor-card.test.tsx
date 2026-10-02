// @vitest-environment jsdom

import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Maintenance, StatusView } from '@flarewatch/shared';
import type { AdminMonitor } from '@/lib/public-view';
import { renderWithProviders, withProviders } from '../helpers/render';

// jsdom has no ResizeObserver; the card body only measures its container width.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const { MonitorRow } = await import('@/components/monitor-card');

afterEach(cleanup);

const LAST_UPDATE = Date.parse('2025-01-15T12:00:00Z') / 1000;
const api: AdminMonitor = { id: 'api', name: 'API', method: 'GET', maxLatencyMs: 500 };
const slowState: StatusView = {
  lastUpdate: LAST_UPDATE,
  monitors: {
    api: {
      status: 'up',
      startedAt: LAST_UPDATE - 30 * 86_400,
      incidents: [],
      latest: { loc: 'FRA', ping: 900, time: LAST_UPDATE },
    },
  },
};
const coveringWindow: Maintenance = {
  id: 'w1',
  start: '2025-01-15T11:00:00.000Z',
  monitors: ['api'],
  body: 'Database upgrade',
  createdAt: 0,
  updatedAt: 0,
};

const row = (maintenances: Maintenance[] = []) =>
  withProviders(<MonitorRow monitor={api} state={slowState} maintenances={maintenances} />);

describe('MonitorRow for a check slower than its maxLatencyMs', () => {
  it('shows degraded without touching uptime', () => {
    const { container } = renderWithProviders(row());

    expect(screen.getByRole('link', { name: /^API, responding slowly, 100\.00%, / })).toBeTruthy();
    expect(screen.getByText('Slow response, over 500ms')).toBeTruthy();
    expect(container.querySelector('svg.text-status-degraded-text')).not.toBeNull();
  });

  it('shows up while a maintenance window covers it', () => {
    const { container } = renderWithProviders(row([coveringWindow]));

    expect(screen.getByRole('link', { name: /^API, operational, 100\.00%, / })).toBeTruthy();
    expect(screen.queryByText('Slow response, over 500ms')).toBeNull();
    expect(container.querySelector('svg.text-status-operational')).not.toBeNull();
  });

  it('renders the same markup on the server and in the browser', async () => {
    const html = renderToString(row());
    expect(html).toContain('Slow response, over 500ms');

    const serverMarkup = document.createElement('div');
    serverMarkup.innerHTML = html;
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, row(), { onRecoverableError: (error) => errors.push(error) });
    });

    expect(errors).toEqual([]);
    expect(container.innerHTML).toBe(serverMarkup.innerHTML);
    container.remove();
  });
});

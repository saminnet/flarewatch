// @vitest-environment jsdom

import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';
import type { Incident, Maintenance, StatusView } from '@flarewatch/shared';
import type { AdminMonitor } from '@/lib/public-view';
import { renderWithProviders, withProviders } from '../helpers/render';

import { MonitorRow } from '@/components/monitor-card';

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
  withProviders(
    <MonitorRow
      monitor={api}
      state={slowState}
      maintenances={maintenances}
      nowMs={LAST_UPDATE * 1000}
    />,
  );

describe('MonitorRow for a check slower than its maxLatencyMs', () => {
  it('shows an expiry warning with degraded status and unchanged uptime', () => {
    const state: StatusView = {
      lastUpdate: LAST_UPDATE,
      monitors: {
        api: {
          status: 'degraded',
          warning: 'Certificate expires soon',
          startedAt: LAST_UPDATE - 86400,
          incidents: [],
        },
      },
    };
    renderWithProviders(
      withProviders(
        <MonitorRow monitor={api} state={state} maintenances={[]} nowMs={LAST_UPDATE * 1000} />,
      ),
    );
    expect(screen.getByText('Certificate expires soon')).toBeTruthy();
    expect(screen.queryByText('Slow response, over 500ms')).toBeNull();
    expect(screen.getByText('100.00%')).toBeTruthy();
  });
  it('shows degraded without touching uptime', () => {
    renderWithProviders(row());

    expect(screen.getByRole('link', { name: /^API, responding slowly, 100\.00%, / })).toBeTruthy();
    expect(screen.getByText('Slow response, over 500ms')).toBeTruthy();
  });

  it('shows up while a maintenance window covers it', () => {
    renderWithProviders(row([coveringWindow]));

    expect(screen.getByRole('link', { name: /^API, operational, 100\.00%, / })).toBeTruthy();
    expect(screen.queryByText('Slow response, over 500ms')).toBeNull();
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
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, row(), {
          onRecoverableError: (error) => errors.push(error),
        });
      });

      expect(errors).toEqual([]);
      expect(container.innerHTML).toBe(serverMarkup.innerHTML);
    } finally {
      act(() => root?.unmount());
      container.remove();
    }
  });
});

describe('MonitorRow with an open incident', () => {
  const checkout: AdminMonitor = { id: 'checkout', name: 'Checkout API', method: 'GET' };
  const downWith = (incident: Incident): StatusView => ({
    lastUpdate: LAST_UPDATE,
    monitors: {
      checkout: { status: 'down', startedAt: LAST_UPDATE - 86_400, incidents: [incident] },
    },
  });
  const open: Incident = { start: [LAST_UPDATE - 20 * 60], error: ['HTTP 503'] };
  const acked: Incident = { ...open, acked_at: LAST_UPDATE - 12 * 60, acked_by: 'Pat' };
  const renderRow = (incident: Incident, operator: boolean) =>
    renderWithProviders(
      <MonitorRow
        monitor={checkout}
        state={downWith(incident)}
        maintenances={[]}
        nowMs={LAST_UPDATE * 1000}
        operator={operator}
      />,
    );
  const page = () => document.body.textContent ?? '';

  it('gives the operator no action on the card, only on the incident', () => {
    renderRow(open, true);
    expect(screen.queryByRole('button', { name: /acknowledg/i })).toBeNull();
    expect(page()).not.toContain('Acknowledged');
  });

  it('shows the operator who acknowledged it as part of the status line', () => {
    renderRow(acked, true);
    expect(page()).toContain('HTTP 503');
    expect(page()).toContain('Acknowledged 12m ago by Pat');
    expect(
      screen.getByRole('link', { name: /^Checkout API, not operational, acknowledged, / }),
    ).toBeTruthy();
  });

  it('shows a visitor that it is acknowledged without the responder', () => {
    renderRow(acked, false);
    expect(page()).toContain('Acknowledged 12m ago');
    expect(page()).not.toContain('Pat');
  });
});

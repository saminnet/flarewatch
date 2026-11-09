// @vitest-environment jsdom
import { useQuery } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { Incident } from '@flarewatch/shared';
import { IncidentCard } from '@/components/history/incident-card';
import { qk } from '@/lib/query/keys';
import { renderWithProviders } from '../helpers/render';

const NOW_MS = Date.parse('2025-01-15T12:00:00Z');
const NOW = NOW_MS / 1000;
const MIN = 60;
const open: Incident = { start: [NOW - 20 * MIN], error: ['HTTP 503'] };
const acked: Incident = { ...open, acked_at: NOW - 12 * MIN, acked_by: 'Pat' };
const ended: Incident = {
  start: [NOW - 60 * MIN],
  end: NOW - 30 * MIN,
  error: ['HTTP 503'],
  acked_at: NOW - 60 * MIN + 2 * MIN + 5,
  acked_by: 'Pat',
};

function CardFor({
  incident,
  operator = false,
  nowMs = NOW_MS,
}: {
  incident: Incident;
  operator?: boolean;
  nowMs?: number;
}) {
  return (
    <IncidentCard
      event={{
        type: 'incident',
        monitorId: 'checkout',
        monitorName: 'Checkout API',
        start: incident.start[0] ?? 0,
        end: incident.end,
        errors: incident.error,
        incident,
      }}
      nowMs={nowMs}
      operator={operator}
    />
  );
}

/** The History entry fed by the snapshot query, the way the page refetches it after an ack. */
function LiveCard({ load }: { load: () => Incident }) {
  const { data } = useQuery({ queryKey: qk.operatorSnapshot, queryFn: load });
  return data ? <CardFor incident={data} operator /> : null;
}

/** The ack endpoint, held until `release`. On 204 the next snapshot carries the acknowledgement. */
function stubAckServer(status: number, body?: unknown) {
  let incident = open;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: unknown[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const sent: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ url, method: init?.method, body: sent });
    await gate;
    if (status !== 204) return Response.json(body, { status });
    incident = { ...open, acked_at: NOW, acked_by: 'Pat' };
    return new Response(null, { status });
  });
  return { requests, release, load: () => incident };
}

const page = () => document.body.textContent ?? '';
const ackButton = () =>
  screen.queryByRole('button', { name: 'Acknowledge incident on Checkout API' });

describe('Incident acknowledgement on a History entry', () => {
  it('offers no action to a visitor', () => {
    renderWithProviders(<CardFor incident={open} />);
    expect(ackButton()).toBeNull();
    expect(page()).not.toContain('Acknowledge');
  });

  it('gives the operator an action named for the monitor that says what it does', () => {
    renderWithProviders(<CardFor incident={open} operator />);
    const button = ackButton();
    expect(button?.textContent).toBe('Acknowledge');
    const hint = document.getElementById(button?.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('Stops reminders. Visitors see the time, not your name.');
  });

  it('offers no action on an ended incident', () => {
    renderWithProviders(<CardFor incident={{ ...open, end: NOW }} operator />);
    expect(ackButton()).toBeNull();
  });

  it('shows the operator who acknowledged an open incident and how long ago', () => {
    renderWithProviders(<CardFor incident={acked} operator />);
    expect(page()).toContain('Acknowledged 12m ago by Pat');
    expect(ackButton()).toBeNull();
  });

  it('shows a visitor the time but never the responder', () => {
    renderWithProviders(<CardFor incident={acked} />);
    expect(page()).toContain('Acknowledged 12m ago');
    expect(page()).not.toContain('Pat');
  });

  it('says just now for the first minute, then counts minutes', () => {
    const ackedMs = (acked.acked_at ?? 0) * 1000;
    renderWithProviders(<CardFor incident={acked} nowMs={ackedMs + 59_999} />);
    expect(page()).toContain('Acknowledged just now');
    cleanup();
    renderWithProviders(<CardFor incident={acked} nowMs={ackedMs + 60_000} />);
    expect(page()).toContain('Acknowledged 1m ago');
  });

  it('counts a month-old acknowledgement in days', () => {
    const old = { ...acked, acked_at: NOW - 30 * 86_400 - 3 * 3600 };
    renderWithProviders(<CardFor incident={old} operator />);
    expect(page()).toContain('Acknowledged 30d 3h ago by Pat');
  });

  it('shows how long an ended incident waited for its acknowledgement', () => {
    renderWithProviders(<CardFor incident={ended} operator />);
    expect(page()).toContain('Acknowledged after 2m 5s by Pat');
  });

  it('acknowledges, shows progress, then moves focus to the new status', async () => {
    const server = stubAckServer(204);
    renderWithProviders(<LiveCard load={server.load} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Acknowledge incident/ }));

    const pending = await screen.findByRole('button', {
      name: 'Acknowledging incident on Checkout API',
    });
    expect(pending.textContent).toBe('Acknowledging...');
    expect(pending.hasAttribute('disabled')).toBe(true);
    expect(server.requests).toEqual([
      { url: '/api/admin/ack', method: 'POST', body: { id: 'checkout' } },
    ]);

    server.release();
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe('Acknowledged just now by Pat'),
    );
    expect(ackButton()).toBeNull();
  });

  it('keeps the action and says why when the server refuses', async () => {
    const server = stubAckServer(500, { error: 'Internal server error' });
    server.release();
    renderWithProviders(<LiveCard load={server.load} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Acknowledge incident/ }));

    await waitFor(() =>
      expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toContain(
        'Internal server error',
      ),
    );
    expect(ackButton()?.hasAttribute('disabled')).toBe(false);
  });

  it('asks the operator to sign in again when the session expired', async () => {
    const server = stubAckServer(401, { error: 'Unauthorized' });
    server.release();
    renderWithProviders(<LiveCard load={server.load} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Acknowledge incident/ }));

    await waitFor(() =>
      expect(page()).toContain('Your session has expired. Sign in again to save changes.'),
    );
  });
});

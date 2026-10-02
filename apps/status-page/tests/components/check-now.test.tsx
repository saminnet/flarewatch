// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { useState } from 'react';
import type { StatusView } from '@flarewatch/shared';
import type { AdminMonitor } from '@/lib/public-view';
import { renderWithProviders } from '../helpers/render';

// jsdom has no ResizeObserver; the card body only measures its container width.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const { MonitorDetail } = await import('@/components/monitor-card');

afterEach(cleanup);

const api: AdminMonitor = { id: 'api', name: 'API', method: 'GET' };
const backup: AdminMonitor = {
  id: 'backup',
  name: 'Backup',
  method: 'HEARTBEAT',
  periodSeconds: 3600,
  graceSeconds: 60,
};
const state: StatusView = { lastUpdate: 0, monitors: {} };

function renderDetail(monitor: AdminMonitor, operator: boolean) {
  renderWithProviders(
    <MonitorDetail monitor={monitor} state={state} maintenances={[]} operator={operator} />,
  );
}

/** The status page answers POST /api/admin/check with this. */
function stubServer(status: number, body: unknown) {
  const fetch = vi.fn(async (_input: string, _init?: RequestInit) =>
    Response.json(body, { status }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const checkNowButton = () => screen.queryByRole('button', { name: 'Check now' });
const result = () => screen.getByRole('status', { name: 'Check now result' });

describe('Check now on the monitor page', () => {
  it('shows only to the operator, and only for a check monitor', () => {
    renderDetail(api, false);
    expect(checkNowButton()).toBeNull();
    cleanup();

    renderDetail(backup, true);
    expect(checkNowButton()).toBeNull();
    cleanup();

    renderDetail(api, true);
    expect(checkNowButton()).not.toBeNull();
  });

  it('asks for this monitor and shows an up result with latency and location', async () => {
    const fetch = stubServer(200, { location: 'HEL', result: { ok: true, latency: 87 } });
    renderDetail(api, true);

    fireEvent.click(checkNowButton()!);

    await waitFor(() => expect(result().textContent).toContain('Up'));
    expect(result().textContent).toContain('87ms');
    expect(result().textContent).toContain('HEL');
    expect(result().textContent).toContain('Helsinki');
    expect(fetch).toHaveBeenCalledWith('/api/admin/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'api' }),
    });
  });

  it('shows a down result with its error text', async () => {
    stubServer(200, { location: 'FRA', result: { ok: false, error: 'HTTP 503' } });
    renderDetail(api, true);

    fireEvent.click(checkNowButton()!);

    await waitFor(() => expect(result().textContent).toContain('Down'));
    expect(result().textContent).toContain('HTTP 503');
    expect(result().textContent).toContain('FRA');
  });

  it('says it is checking while the check runs', async () => {
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    renderDetail(api, true);

    fireEvent.click(checkNowButton()!);

    await waitFor(() => expect(result().textContent).toBe('Checking...'));
    expect(checkNowButton()?.hasAttribute('disabled')).toBe(true);
    answer(Response.json({ location: 'HEL', result: { ok: true, latency: 87 } }));
    await waitFor(() => expect(result().textContent).toContain('Up'));
    expect(result().textContent).not.toContain('Checking');
  });

  it.each([
    ['the reason the server refused', 401, { error: 'Not authenticated' }, 'Not authenticated'],
    ['a malformed answer', 200, { location: 'FRA' }, 'Unexpected response shape'],
  ])('shows %s', async (_name, status, body, message) => {
    stubServer(status, body);
    renderDetail(api, true);

    fireEvent.click(checkNowButton()!);

    await waitFor(() => expect(result().textContent).toBe(message));
    expect(checkNowButton()?.hasAttribute('disabled')).toBe(false);
  });

  describe('after moving to another monitor on the same page', () => {
    const docs: AdminMonitor = { id: 'docs', name: 'Docs', method: 'GET' };

    /** The router keeps the page mounted and swaps the monitor, as a client-side link does. */
    function Navigator() {
      const [monitor, setMonitor] = useState(api);
      return (
        <>
          <button type="button" onClick={() => setMonitor(docs)}>
            Open Docs
          </button>
          <MonitorDetail monitor={monitor} state={state} maintenances={[]} operator />
        </>
      );
    }

    it("shows nothing of the previous monitor's result", async () => {
      stubServer(200, { location: 'FRA', result: { ok: false, error: 'HTTP 503' } });
      renderWithProviders(<Navigator />);
      fireEvent.click(checkNowButton()!);
      await waitFor(() => expect(result().textContent).toContain('HTTP 503'));

      fireEvent.click(screen.getByRole('button', { name: 'Open Docs' }));

      expect(result().textContent).toBe('');
    });

    it('drops a result that arrives after the move', async () => {
      let answer: (response: Response) => void = () => {};
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
      );
      renderWithProviders(<Navigator />);
      fireEvent.click(checkNowButton()!);

      fireEvent.click(screen.getByRole('button', { name: 'Open Docs' }));
      answer(Response.json({ location: 'FRA', result: { ok: false, error: 'HTTP 503' } }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(result().textContent).toBe('');
      expect(checkNowButton()?.hasAttribute('disabled')).toBe(false);
    });
  });
});

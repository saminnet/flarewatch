// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { CopyPingUrlButton } from '@/components/admin/copy-ping-url-button';

const getHeartbeatPingUrl = vi.fn<(id: string) => Promise<string | null>>();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(writeText = vi.fn(async () => undefined)) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CopyPingUrlButton
        monitorId="backup"
        monitorName="Backup"
        loadPingUrl={getHeartbeatPingUrl}
      />
    </QueryClientProvider>,
  );
  return { writeText, button: screen.getByRole('button', { name: 'Copy ping URL for Backup' }) };
}

const UNAVAILABLE = 'Set HEARTBEAT_SECRET to generate ping URLs';

describe('CopyPingUrlButton', () => {
  it('copies the URL and announces it', async () => {
    getHeartbeatPingUrl.mockResolvedValue('https://status.test/ping/backup/tok');
    const { writeText, button } = setup();

    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith('https://status.test/ping/backup/tok');
  });

  it.each<[string, () => Promise<string | null>]>([
    ['no url configured', async () => null],
    [
      'request failure',
      async () => {
        throw new Error('unauthorized');
      },
    ],
  ])('announces unavailable on %s and stays enabled', async (_name, loadUrl) => {
    getHeartbeatPingUrl.mockImplementation(loadUrl);
    const { writeText, button } = setup();

    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText(UNAVAILABLE)).toBeTruthy());
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies on a retry once the URL becomes available', async () => {
    getHeartbeatPingUrl
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('https://status.test/ping/backup/tok');
    const { writeText, button } = setup();

    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(UNAVAILABLE)).toBeTruthy());

    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith('https://status.test/ping/backup/tok');
  });

  it('opens a dialog with the URL when the clipboard rejects', async () => {
    getHeartbeatPingUrl.mockResolvedValue('https://status.test/ping/backup/tok');
    const { button } = setup(
      vi.fn(async () => {
        throw new Error('denied');
      }),
    );

    fireEvent.click(button);

    const input = await screen.findByDisplayValue('https://status.test/ping/backup/tok');
    expect(input.hasAttribute('readonly')).toBe(true);
    expect(screen.getByText('Copy failed, select the URL manually')).toBeTruthy();
  });
});

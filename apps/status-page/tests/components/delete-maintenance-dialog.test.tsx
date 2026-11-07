// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';
import { DeleteMaintenanceDialog } from '@/components/maintenance/delete-maintenance-dialog';
import { renderWithProviders } from '../helpers/render';

function DialogSession() {
  const [open, setOpen] = useState(true);
  const [session, setSession] = useState(0);
  return (
    <>
      <button
        onClick={() => {
          setSession((key) => key + 1);
          setOpen(true);
        }}
      >
        Reopen
      </button>
      <button onClick={() => setOpen(false)}>Close externally</button>
      <DeleteMaintenanceDialog
        key={session}
        open={open}
        maintenance={{
          id: 'window',
          title: 'Database upgrade',
          body: 'Upgrade',
          start: '2026-06-10T02:00:00Z',
          createdAt: 0,
          updatedAt: 0,
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

it('shows a failed submit and clears it after close and reopen', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json({ error: 'Changes are temporarily unavailable' }, { status: 503 }),
  );
  renderWithProviders(<DialogSession />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText('Changes are temporarily unavailable')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(screen.queryByText('Changes are temporarily unavailable')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText('Changes are temporarily unavailable')).toBeTruthy();
  fireEvent.click(screen.getByText('Close externally'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  expect(screen.queryByText('Changes are temporarily unavailable')).toBeNull();
});

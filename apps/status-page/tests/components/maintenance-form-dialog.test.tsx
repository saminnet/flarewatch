// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';
import { MaintenanceFormDialog } from '@/components/maintenance/maintenance-form-dialog';
import { renderWithProviders } from '../helpers/render';

function DialogSession({ create }: { create: boolean }) {
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
      <MaintenanceFormDialog
        key={session}
        open={open}
        maintenance={
          create
            ? undefined
            : {
                id: 'window',
                title: 'Database upgrade',
                body: 'Upgrade',
                start: '2026-06-10T02:00:00Z',
                createdAt: 0,
                updatedAt: 0,
              }
        }
        monitors={[]}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

it.each([true, false])(
  'shows a failed submit and clears it after close and reopen (create=%s)',
  async (create) => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: 'Changes are temporarily unavailable' }, { status: 503 }),
    );
    renderWithProviders(<DialogSession create={create} />);
    const save = async () => {
      if (create) {
        fireEvent.change(screen.getByLabelText('Description'), {
          target: { value: 'Database upgrade' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Select start date' }));
        fireEvent.click(await screen.findByRole('button', { name: /15th,/ }));
      }
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    };
    await save();
    expect(await screen.findByText('Changes are temporarily unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.queryByText('Changes are temporarily unavailable')).toBeNull();
    await save();
    expect(await screen.findByText('Changes are temporarily unavailable')).toBeTruthy();
    fireEvent.click(screen.getByText('Close externally'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.queryByText('Changes are temporarily unavailable')).toBeNull();
  },
);

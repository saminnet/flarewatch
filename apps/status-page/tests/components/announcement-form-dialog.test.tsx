// @vitest-environment jsdom
import { useState } from 'react';
import { expect, it, vi } from 'vite-plus/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { AnnouncementFormDialog } from '@/components/announcements/announcement-form-dialog';
import { renderWithProviders } from '../helpers/render';

function Editor({ editing }: { editing: boolean }) {
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
      <AnnouncementFormDialog
        key={session}
        open={open}
        onClose={() => setOpen(false)}
        announcement={
          editing
            ? { id: 'api', title: 'API delays', body: 'Investigating', createdAt: 1, updatedAt: 1 }
            : undefined
        }
      />
    </>
  );
}

it.each([false, true])(
  'shows a failed save and clears it on close and open (editing=%s)',
  async (editing) => {
    vi.stubGlobal('fetch', async () => Response.json({ error: 'Save refused' }, { status: 400 }));
    renderWithProviders(<Editor editing={editing} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'API delays' } });
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: 'Investigating' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Save refused')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByText('Save refused')).toBeNull();
  },
);

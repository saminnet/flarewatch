// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vite-plus/test';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import type { Announcement } from '@flarewatch/shared';
import { AnnouncementBanner } from '@/components/announcements/announcement-banner';
import {
  AddAnnouncementButton,
  ManageAnnouncements,
} from '@/components/announcements/announcement-controls';
import { renderWithProviders, withProviders } from '../helpers/render';

const announcements: Announcement[] = [
  {
    id: 'new',
    title: '<script>Update</script>',
    body: '<b>Text</b> & **Markdown**',
    createdAt: 2,
    updatedAt: 2,
  },
  { id: 'old', title: 'Older update', body: 'Details', createdAt: 1, updatedAt: 1, end: 101 },
  { id: 'ended', title: 'Ended update', body: 'Old details', createdAt: 0, updatedAt: 0, end: 100 },
];
describe('AnnouncementBanner', () => {
  it('renders active announcements in order as plain text during SSR and in the browser', () => {
    const ui = <AnnouncementBanner announcements={announcements} nowMs={100} operator={false} />;
    const html = renderToString(withProviders(ui));
    expect(html).toContain('&lt;script&gt;Update&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;Text&lt;/b&gt; &amp; **Markdown**');
    expect(html).not.toContain('Ended update');
    const { container } = renderWithProviders(ui);
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual([
      '<script>Update</script>',
      'Older update',
    ]);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit announcement/ })).toBeNull();
  });

  it('lets operators manage ended announcements on History', () => {
    const { rerender } = renderWithProviders(
      <ManageAnnouncements announcements={announcements} nowMs={100} operator={false} />,
    );
    expect(screen.queryByRole('region', { name: 'Manage announcements' })).toBeNull();
    rerender(
      withProviders(<ManageAnnouncements announcements={announcements} nowMs={100} operator />),
    );
    expect(screen.getByRole('button', { name: 'Edit announcement Ended update' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete announcement Ended update' })).toBeTruthy();
  });

  it('opens the form, requires a title and body, saves plain text and resets on reopen', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
      const body: unknown = JSON.parse(init.body);
      bodies.push(body);
      return Response.json(
        {
          id: 'ann_created',
          title: '<Notice>',
          body: 'Plain **text**',
          createdAt: 1,
          updatedAt: 1,
        },
        { status: 201 },
      );
    });
    renderWithProviders(<AddAnnouncementButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Add announcement' }));
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: ' Plain **text** ' } });
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: ' <Notice> ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodies).toEqual([{ title: '<Notice>', body: 'Plain **text**' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Add announcement' }));
    expect(screen.getByLabelText('Title')).toHaveProperty('value', '');
    expect(screen.getByLabelText('Body')).toHaveProperty('value', '');
  });
});

it('renders incident fields, monitor selection and an update in the form dialog', async () => {
  const { AnnouncementFormDialog } =
    await import('@/components/announcements/announcement-form-dialog');
  const requests: unknown[] = [];
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (typeof init?.body !== 'string') throw new Error('Expected JSON body');
    requests.push(JSON.parse(init.body));
    return Response.json({
      id: 'incident',
      title: 'API delays',
      body: 'Investigating.',
      kind: 'incident',
      status: 'investigating',
      updates: [],
      createdAt: 1,
      updatedAt: 1,
    });
  });
  renderWithProviders(
    <AnnouncementFormDialog
      open
      onClose={() => {}}
      monitors={[{ id: 'api', name: 'API', method: 'GET' }]}
      announcement={{
        id: 'incident',
        title: 'API delays',
        body: 'Investigating.',
        kind: 'incident',
        status: 'investigating',
        createdAt: 1,
        updatedAt: 1,
      }}
    />,
  );
  expect(screen.getByLabelText('Kind')).toBeTruthy();
  expect(screen.getByLabelText('Status')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'API' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add update' }));
  fireEvent.change(screen.getByLabelText('Update'), { target: { value: 'We found the cause.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(requests).toEqual([
      {
        id: 'incident',
        updates: {
          title: 'API delays',
          body: 'Investigating.',
          end: null,
          kind: 'incident',
          status: 'investigating',
          monitors: ['api'],
          addUpdate: { status: 'investigating', body: 'We found the cause.' },
        },
      },
    ]),
  );
});

it('shows the latest update on the banner and every update on History', () => {
  const incident: Announcement = {
    id: 'incident',
    kind: 'incident',
    title: 'API delays',
    body: 'Investigating.',
    status: 'monitoring',
    updates: [
      { at: '2026-10-20T10:00:00Z', status: 'identified', body: 'Cause found.', by: 'Pat' },
      { at: '2026-10-20T11:00:00Z', status: 'monitoring', body: 'Fix deployed.', by: 'Pat' },
    ],
    createdAt: 1,
    updatedAt: 1,
  };
  const { rerender } = renderWithProviders(
    <AnnouncementBanner announcements={[incident]} nowMs={1} />,
  );
  expect(screen.queryByText('Cause found.')).toBeNull();
  expect(screen.getByText('Fix deployed.')).toBeTruthy();
  rerender(
    withProviders(<ManageAnnouncements announcements={[incident]} nowMs={1} operator={false} />),
  );
  expect(screen.getByText('Cause found.')).toBeTruthy();
  expect(screen.getByText('Fix deployed.')).toBeTruthy();
});

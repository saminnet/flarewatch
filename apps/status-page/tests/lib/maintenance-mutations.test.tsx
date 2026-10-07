// @vitest-environment jsdom

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Maintenance } from '@flarewatch/shared';
import { qk } from '@/lib/query/keys';
import type { Snapshot } from '@/lib/public-view';
import {
  useCreateMaintenance,
  useDeleteMaintenance,
  useUpdateMaintenance,
} from '@/lib/query/maintenance.mutations';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const maintenance = (id: string, start: string): Maintenance => ({
  id,
  body: `Window ${id}`,
  start,
  createdAt: 0,
  updatedAt: 0,
});

function setup(saved: Maintenance, initial: Maintenance[] = []) {
  let windows = initial;
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (!init?.method) return Response.json(snapshotWith(windows));
    if (init.method === 'DELETE') windows = windows.filter(({ id }) => id !== saved.id);
    else windows = [saved, ...windows];
    return Response.json(saved, { status: 201 });
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(qk.operatorSnapshot, snapshotWith(initial));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function snapshotWith(maintenances: Maintenance[]): Snapshot {
  return { monitors: [], groups: {}, state: null, maintenances, announcements: [] };
}

function AdminList({ saved, remove = false }: { saved: Maintenance; remove?: boolean }) {
  const snapshot = useQuery({
    queryKey: qk.operatorSnapshot,
    queryFn: async (): Promise<Snapshot> => (await (await fetch('/snapshot')).json()) as Snapshot,
    staleTime: Infinity,
  });
  const create = useCreateMaintenance();
  const deleteWindow = useDeleteMaintenance();
  return (
    <>
      <button
        onClick={() =>
          remove
            ? deleteWindow.mutate(saved.id)
            : create.mutate({ body: saved.body, start: saved.start })
        }
      >
        Save
      </button>
      <ul>
        {snapshot.data?.maintenances.map((window) => (
          <li key={window.id}>{window.body}</li>
        ))}
      </ul>
    </>
  );
}

function SessionView() {
  const session = useQuery({
    queryKey: qk.session,
    queryFn: async (): Promise<{ viewer: string }> =>
      (await (await fetch('/session')).json()) as { viewer: string },
    staleTime: Infinity,
  });
  return <p>{session.data?.viewer === 'operator' ? 'Signed in' : 'Sign in'}</p>;
}

function ExpiredEditor() {
  const [closed, setClosed] = useState(false);
  const update = useUpdateMaintenance();
  return closed ? (
    <SessionView />
  ) : (
    <>
      <button
        onClick={() =>
          update.mutate({
            id: 'x',
            updates: {
              title: null,
              body: 'x',
              start: '2026-01-01T00:00:00.000Z',
              end: null,
              monitors: null,
              color: null,
            },
          })
        }
      >
        Save
      </button>
      {update.isError && (
        <>
          <p role="alert">{update.error.message}</p>
          <button onClick={() => setClosed(true)}>Return</button>
        </>
      )}
    </>
  );
}

describe('maintenance mutations', () => {
  it('shows a created window in the admin list', async () => {
    const existing = maintenance('old', '2026-01-01T00:00:00.000Z');
    const created = maintenance('new', '2026-02-01T00:00:00.000Z');
    const { wrapper } = setup(created, [existing]);
    render(<AdminList saved={created} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        'Window new',
        'Window old',
      ]),
    );
  });

  it('drops a deleted window from the admin list', async () => {
    const kept = maintenance('kept', '2026-01-01T00:00:00.000Z');
    const removed = maintenance('gone', '2026-02-01T00:00:00.000Z');
    const { wrapper } = setup(removed, [removed, kept]);
    render(<AdminList saved={removed} remove />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        'Window kept',
      ]),
    );
  });

  it('forgets the signed-in session when the server says it expired', async () => {
    const { queryClient, wrapper } = setup(maintenance('x', '2026-01-01T00:00:00.000Z'));
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) =>
      init?.method ? new Response(null, { status: 401 }) : Response.json({ viewer: 'visitor' }),
    );
    queryClient.setQueryData(qk.session, { viewer: 'operator' });
    render(<ExpiredEditor />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Session expired');
    fireEvent.click(screen.getByRole('button', { name: 'Return' }));
    expect(await screen.findByText('Sign in')).toBeTruthy();
    expect(screen.queryByText('Signed in')).toBeNull();
  });

  it("shows the server's reason when it turns a window down", async () => {
    const { wrapper } = setup(maintenance('x', '2026-01-01T00:00:00.000Z'));
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: 'Too many maintenance windows' }, { status: 400 }),
    );
    const { result } = renderHook(() => useCreateMaintenance(), { wrapper });
    result.current.mutate({ body: 'x', start: '2026-01-01T00:00:00.000Z' });
    await waitFor(() => expect(result.current.error?.message).toBe('Too many maintenance windows'));
  });
});

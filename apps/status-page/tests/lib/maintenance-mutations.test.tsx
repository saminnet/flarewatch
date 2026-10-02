// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Maintenance } from '@flarewatch/shared';
import { qk } from '@/lib/query/keys';
import type { Snapshot } from '@/lib/public-view';

const { useCreateMaintenance, useDeleteMaintenance, useUpdateMaintenance } =
  await import('../../src/lib/query/maintenance.mutations');

afterEach(() => {
  vi.unstubAllGlobals();
});

const maintenance = (id: string, start: string): Maintenance => ({
  id,
  body: `Window ${id}`,
  start,
  createdAt: 0,
  updatedAt: 0,
});

function setup(saved: Maintenance) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(saved, { status: 201 })),
  );
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function snapshotWith(maintenances: Maintenance[]): Snapshot {
  return { monitors: [], groups: {}, state: null, maintenances };
}

function operatorMaintenances(queryClient: QueryClient): Maintenance[] | undefined {
  return queryClient.getQueryData<Snapshot>(qk.operatorSnapshot)?.maintenances;
}

describe('maintenance mutations', () => {
  it('shows a created window in the admin list', async () => {
    const existing = maintenance('old', '2026-01-01T00:00:00.000Z');
    const created = maintenance('new', '2026-02-01T00:00:00.000Z');
    const { queryClient, wrapper } = setup(created);
    queryClient.setQueryData(qk.operatorSnapshot, snapshotWith([existing]));

    const { result } = renderHook(() => useCreateMaintenance(), { wrapper });
    result.current.mutate({ body: created.body, start: created.start });

    await waitFor(() => expect(operatorMaintenances(queryClient)).toEqual([created, existing]));
  });

  it('drops a deleted window from the admin list', async () => {
    const kept = maintenance('kept', '2026-01-01T00:00:00.000Z');
    const removed = maintenance('gone', '2026-02-01T00:00:00.000Z');
    const { queryClient, wrapper } = setup(removed);
    queryClient.setQueryData(qk.operatorSnapshot, snapshotWith([removed, kept]));

    const { result } = renderHook(() => useDeleteMaintenance(), { wrapper });
    result.current.mutate('gone');

    await waitFor(() => expect(operatorMaintenances(queryClient)).toEqual([kept]));
  });

  it('forgets the signed-in session when the server says it expired', async () => {
    const { queryClient, wrapper } = setup(maintenance('x', '2026-01-01T00:00:00.000Z'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    queryClient.setQueryData(qk.session, { viewer: 'operator' });

    const { result } = renderHook(() => useUpdateMaintenance(), { wrapper });
    result.current.mutate({
      id: 'x',
      updates: {
        title: null,
        body: 'x',
        start: '2026-01-01T00:00:00.000Z',
        end: null,
        monitors: null,
        color: null,
      },
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(queryClient.getQueryData(qk.session)).toBeUndefined();
  });

  it("shows the server's reason when it turns a window down", async () => {
    const { wrapper } = setup(maintenance('x', '2026-01-01T00:00:00.000Z'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Too many maintenance windows' }, { status: 400 })),
    );

    const { result } = renderHook(() => useCreateMaintenance(), { wrapper });
    result.current.mutate({ body: 'x', start: '2026-01-01T00:00:00.000Z' });

    await waitFor(() => expect(result.current.error?.message).toBe('Too many maintenance windows'));
  });
});

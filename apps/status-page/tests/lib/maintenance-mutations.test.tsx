// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Maintenance } from '@flarewatch/shared';
import { qk } from '@/lib/query/keys';

await import('../../src/lib/i18n');
const { useCreateMaintenance, useDeleteMaintenance } =
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

describe('maintenance mutations', () => {
  it('shows a created window in the admin list', async () => {
    const existing = maintenance('old', '2026-01-01T00:00:00.000Z');
    const created = maintenance('new', '2026-02-01T00:00:00.000Z');
    const { queryClient, wrapper } = setup(created);
    queryClient.setQueryData(qk.adminMaintenances, [existing]);

    const { result } = renderHook(() => useCreateMaintenance(), { wrapper });
    result.current.mutate({ body: created.body, start: created.start });

    await waitFor(() =>
      expect(queryClient.getQueryData(qk.adminMaintenances)).toEqual([created, existing]),
    );
  });

  it('drops a deleted window from the admin list', async () => {
    const kept = maintenance('kept', '2026-01-01T00:00:00.000Z');
    const removed = maintenance('gone', '2026-02-01T00:00:00.000Z');
    const { queryClient, wrapper } = setup(removed);
    queryClient.setQueryData(qk.adminMaintenances, [removed, kept]);

    const { result } = renderHook(() => useDeleteMaintenance(), { wrapper });
    result.current.mutate('gone');

    await waitFor(() => expect(queryClient.getQueryData(qk.adminMaintenances)).toEqual([kept]));
  });
});

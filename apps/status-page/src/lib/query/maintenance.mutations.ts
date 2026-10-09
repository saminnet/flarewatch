import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  isValidMaintenance,
  type Maintenance,
  type MaintenanceConfig,
  type MaintenanceRepeat,
} from '@flarewatch/shared';
import { compareByStart } from '../maintenance';
import type { Snapshot } from '../public-view';
import { qk } from './keys';
import { requestOk, reportError, type MutationCallbacks } from './request';

const API_PATH = '/api/admin/maintenances';

function setMaintenances(
  queryClient: QueryClient,
  updater: (current: Maintenance[]) => Maintenance[],
  { sort = false } = {},
): void {
  queryClient.setQueryData<Snapshot>(qk.operatorSnapshot, (current) => {
    if (!current) return current;
    const result = updater(current.maintenances);
    return {
      ...current,
      maintenances: sort ? result.sort((a, b) => compareByStart(b, a)) : result,
    };
  });
  void queryClient.invalidateQueries({ queryKey: qk.snapshot });
}

export type MaintenanceUpdatePatch = {
  title: string | null;
  body: string;
  start: string;
  end: string | null;
  monitors: string[] | null;
  color: string | null;
  repeat?: MaintenanceRepeat | null;
};

async function requestMaintenance(path: string, init: RequestInit): Promise<Maintenance> {
  const res = await requestOk(path, init);
  const data: unknown = await res.json();
  if (!isValidMaintenance(data)) throw new Error('Unexpected response shape');
  return data;
}

export function useCreateMaintenance(callbacks?: MutationCallbacks<Maintenance>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: MaintenanceConfig) => {
      return requestMaintenance(API_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: (result) => {
      setMaintenances(queryClient, (current) => [...current, result], { sort: true });
      callbacks?.onSuccess?.(result);
    },
    onError: (error) => reportError(queryClient, error, callbacks?.onError),
  });
}

export function useUpdateMaintenance(callbacks?: MutationCallbacks<Maintenance>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: MaintenanceUpdatePatch }) => {
      return requestMaintenance(API_PATH, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, updates }),
      });
    },
    onSuccess: (result) => {
      setMaintenances(
        queryClient,
        (current) => current.map((m) => (m.id === result.id ? result : m)),
        { sort: true },
      );
      callbacks?.onSuccess?.(result);
    },
    onError: (error) => reportError(queryClient, error, callbacks?.onError),
  });
}

export function useDeleteMaintenance(callbacks?: MutationCallbacks<string>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await requestOk(API_PATH, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      return id;
    },
    onSuccess: (id) => {
      setMaintenances(queryClient, (current) => current.filter((m) => m.id !== id));
      callbacks?.onSuccess?.(id);
    },
    onError: (error) => reportError(queryClient, error, callbacks?.onError),
  });
}

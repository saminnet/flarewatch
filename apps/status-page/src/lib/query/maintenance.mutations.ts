import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Maintenance, MaintenanceConfig } from '@flarewatch/shared';
import { compareByStart } from '../maintenance';
import { qk } from './keys';
import { SessionExpiredError } from './auth.mutations';

const API_PATH = '/api/admin/maintenances';

type TranslateFn = ReturnType<typeof useTranslation>['t'];

function setMaintenances(
  queryClient: QueryClient,
  updater: (current: Maintenance[]) => Maintenance[],
  { sort = false } = {},
): void {
  queryClient.setQueryData<Maintenance[]>(qk.maintenances, (current) => {
    const result = updater(current ?? []);
    return sort ? result.sort((a, b) => compareByStart(b, a)) : result;
  });
}

function normalizeMutationError(error: unknown, t: TranslateFn): Error {
  return error instanceof Error ? error : new Error(t('error.somethingWrong'));
}

export type MaintenanceUpdatePatch = {
  title: string | null;
  body: string;
  start: string;
  end: string | null;
  monitors: string[] | null;
  color: string | null;
};

async function request<T = void>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    // Detect session expiry
    if (res.status === 401) {
      throw new SessionExpiredError();
    }
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed (${res.status})`);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return (await res.json()) as T;
}

interface MutationCallbacks<T = Maintenance> {
  onSuccess?: (result: T) => void;
  onError?: (error: Error) => void;
}

export function useCreateMaintenance(callbacks?: MutationCallbacks) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: MaintenanceConfig) => {
      return request<Maintenance>(API_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: (result) => {
      setMaintenances(queryClient, (current) => [...current, result], { sort: true });
      void queryClient.invalidateQueries({ queryKey: qk.maintenances });
      callbacks?.onSuccess?.(result);
    },
    onError: (error) => {
      callbacks?.onError?.(normalizeMutationError(error, t));
    },
  });
}

export function useUpdateMaintenance(callbacks?: MutationCallbacks) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: MaintenanceUpdatePatch }) => {
      return request<Maintenance>(API_PATH, {
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
      void queryClient.invalidateQueries({ queryKey: qk.maintenances });
      callbacks?.onSuccess?.(result);
    },
    onError: (error) => {
      callbacks?.onError?.(normalizeMutationError(error, t));
    },
  });
}

export function useDeleteMaintenance(callbacks?: MutationCallbacks<string>) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await request(API_PATH, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      return id;
    },
    onSuccess: (id) => {
      setMaintenances(queryClient, (current) => current.filter((m) => m.id !== id));
      void queryClient.invalidateQueries({ queryKey: qk.maintenances });
      callbacks?.onSuccess?.(id);
    },
    onError: (error) => {
      callbacks?.onError?.(normalizeMutationError(error, t));
    },
  });
}

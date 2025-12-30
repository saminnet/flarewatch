import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Maintenance, MaintenanceConfig } from '@flarewatch/shared';
import { qk } from './keys';

const API_PATH = '/api/admin/maintenances';

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
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed (${res.status})`);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return (await res.json()) as T;
}

interface MutationCallbacks {
  onSuccess?: (result: Maintenance | void, variable: unknown) => void;
  onError?: (error: Error) => void;
}

export function useCreateMaintenance(callbacks?: MutationCallbacks) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: MaintenanceConfig) => {
      return await request<Maintenance>(API_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: qk.maintenances });
      callbacks?.onSuccess?.(result, undefined);
    },
    onError: (error) => {
      const err = error instanceof Error ? error : new Error(t('error.somethingWrong'));
      callbacks?.onError?.(err);
    },
  });
}

export function useUpdateMaintenance(callbacks?: MutationCallbacks) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: MaintenanceUpdatePatch }) => {
      return await request<Maintenance>(API_PATH, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, updates }),
      });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: qk.maintenances });
      callbacks?.onSuccess?.(result, undefined);
    },
    onError: (error) => {
      const err = error instanceof Error ? error : new Error(t('error.somethingWrong'));
      callbacks?.onError?.(err);
    },
  });
}

export function useDeleteMaintenance(
  callbacks?: Omit<MutationCallbacks, 'onSuccess'> & { onSuccess?: (id: string) => void },
) {
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
      void queryClient.invalidateQueries({ queryKey: qk.maintenances });
      callbacks?.onSuccess?.(id);
    },
    onError: (error) => {
      const err = error instanceof Error ? error : new Error(t('error.somethingWrong'));
      callbacks?.onError?.(err);
    },
  });
}

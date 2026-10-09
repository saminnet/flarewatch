import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  isValidAnnouncement,
  type Announcement,
  type AnnouncementConfig,
} from '@flarewatch/shared';
import type { Snapshot } from '../public-view';
import { qk } from './keys';
import { requestOk, reportError, type MutationCallbacks } from './request';

const API_PATH = '/api/admin/announcements';

function setAnnouncements(
  queryClient: QueryClient,
  updater: (current: Announcement[]) => Announcement[],
): void {
  queryClient.setQueryData<Snapshot>(qk.operatorSnapshot, (current) => {
    if (!current) return current;
    return { ...current, announcements: updater(current.announcements) };
  });
  void queryClient.invalidateQueries({ queryKey: qk.snapshot });
}

async function requestAnnouncement(path: string, init: RequestInit): Promise<Announcement> {
  const res = await requestOk(path, init);
  const data: unknown = await res.json();
  if (!isValidAnnouncement(data)) throw new Error('Unexpected response shape');
  return data;
}

export function useCreateAnnouncement(callbacks?: MutationCallbacks<Announcement>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: AnnouncementConfig) => {
      return requestAnnouncement(API_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: (result) => {
      setAnnouncements(queryClient, (current) => [result, ...current]);
      callbacks?.onSuccess?.(result);
    },
    onError: (error) => reportError(queryClient, error, callbacks?.onError),
  });
}

export function useUpdateAnnouncement(callbacks?: MutationCallbacks<Announcement>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: AnnouncementUpdatePatch }) => {
      return requestAnnouncement(API_PATH, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, updates }),
      });
    },
    onSuccess: (result) => {
      setAnnouncements(queryClient, (current) =>
        current.map((a) => (a.id === result.id ? result : a)),
      );
      callbacks?.onSuccess?.(result);
    },
    onError: (error) => reportError(queryClient, error, callbacks?.onError),
  });
}

export function useDeleteAnnouncement(callbacks?: MutationCallbacks<string>) {
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
      setAnnouncements(queryClient, (current) => current.filter((a) => a.id !== id));
      callbacks?.onSuccess?.(id);
    },
    onError: (error) => reportError(queryClient, error, callbacks?.onError),
  });
}

export type AnnouncementUpdatePatch = {
  title: string;
  body: string;
  end: string | null;
};

import { queryOptions } from '@tanstack/react-query';
import { getOperatorSnapshot, getVisitorSnapshot } from '@/lib/kv';
import { getUiPrefsServerFn } from '@/lib/ui-prefs-server';
import { getConfigServerFn } from '@/lib/config';
import { qk } from './keys';
import { QUERY_STALE_TIME } from '@/lib/constants';

export const configQuery = () =>
  queryOptions({
    queryFn: () => getConfigServerFn(),
    queryKey: qk.config,
    staleTime: QUERY_STALE_TIME.MONITORS, // 5 minutes - config rarely changes
  });

export const visitorSnapshotQuery = () =>
  queryOptions({
    queryFn: () => getVisitorSnapshot(),
    queryKey: qk.visitorSnapshot,
    staleTime: QUERY_STALE_TIME.DEFAULT, // 30 seconds - KV-backed data
  });

export const operatorSnapshotQuery = () =>
  queryOptions({
    queryFn: () => getOperatorSnapshot(),
    queryKey: qk.operatorSnapshot,
    staleTime: QUERY_STALE_TIME.DEFAULT,
  });

export const uiPrefsQuery = () =>
  queryOptions({
    queryFn: () => getUiPrefsServerFn(),
    queryKey: qk.uiPrefs,
    staleTime: Infinity, // Only changes via user action, not refetch
  });

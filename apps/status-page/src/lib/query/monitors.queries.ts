import { queryOptions } from '@tanstack/react-query';
import { getMaintenances, getMonitorState } from '@/lib/kv';
import { getPublicMonitors } from '@/lib/monitors';
import { getUiPrefsServerFn } from '@/lib/ui-prefs-server';
import { qk } from './keys';

export const monitorStateQuery = () =>
  queryOptions({
    queryFn: () => getMonitorState(),
    queryKey: qk.monitorState,
  });

export const publicMonitorsQuery = () =>
  queryOptions({
    queryFn: () => getPublicMonitors(),
    queryKey: qk.publicMonitors,
    staleTime: 5 * 60_000, // Monitors rarely change
  });

export const uiPrefsQuery = () =>
  queryOptions({
    queryFn: () => getUiPrefsServerFn(),
    queryKey: qk.uiPrefs,
    staleTime: Infinity, // Only changes via user action, not refetch
  });

export const maintenancesQuery = () =>
  queryOptions({
    queryFn: () => getMaintenances(),
    queryKey: qk.maintenances,
    staleTime: 30_000,
  });

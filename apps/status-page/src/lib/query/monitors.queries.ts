import { queryOptions } from '@tanstack/react-query';
import {
  getAdminMaintenances,
  getAdminMonitorState,
  getMaintenances,
  getMonitorState,
} from '@/lib/kv';
import { getAdminMonitors, getPublicMonitors } from '@/lib/monitors';
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

export const monitorStateQuery = () =>
  queryOptions({
    queryFn: () => getMonitorState(),
    queryKey: qk.monitorState,
    staleTime: QUERY_STALE_TIME.DEFAULT, // 30 seconds - KV-backed data
  });

export const adminMonitorStateQuery = () =>
  queryOptions({
    queryFn: () => getAdminMonitorState(),
    queryKey: qk.adminMonitorState,
    staleTime: QUERY_STALE_TIME.DEFAULT,
  });

export const publicMonitorsQuery = () =>
  queryOptions({
    queryFn: () => getPublicMonitors(),
    queryKey: qk.publicMonitors,
    staleTime: QUERY_STALE_TIME.MONITORS,
  });

export const adminMonitorsQuery = () =>
  queryOptions({
    queryFn: () => getAdminMonitors(),
    queryKey: qk.adminMonitors,
    staleTime: QUERY_STALE_TIME.MONITORS,
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
    staleTime: QUERY_STALE_TIME.DEFAULT,
  });

export const adminMaintenancesQuery = () =>
  queryOptions({
    queryFn: () => getAdminMaintenances(),
    queryKey: qk.adminMaintenances,
    staleTime: QUERY_STALE_TIME.DEFAULT,
  });

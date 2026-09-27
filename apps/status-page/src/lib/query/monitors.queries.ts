import { queryOptions } from '@tanstack/react-query';
import { getMonitorLatency, getOperatorSnapshot, getVisitorSnapshot } from '@/lib/kv';
import { getUiPrefsServerFn } from '@/lib/ui-prefs-server';
import { getConfigServerFn } from '@/lib/config';
import { getSessionServerFn } from '@/lib/session';
import type { Viewer } from '@/lib/operator.server';
import { qk } from './keys';
import { QUERY_STALE_TIME } from '@/lib/constants';

export const configQuery = () =>
  queryOptions({
    queryFn: () => getConfigServerFn(),
    queryKey: qk.config,
    staleTime: QUERY_STALE_TIME.MONITORS, // 5 minutes - config rarely changes
  });

export const snapshotQuery = (audience: Viewer) =>
  queryOptions({
    queryFn: () => (audience === 'operator' ? getOperatorSnapshot() : getVisitorSnapshot()),
    queryKey: audience === 'operator' ? qk.operatorSnapshot : qk.visitorSnapshot,
    staleTime: QUERY_STALE_TIME.DEFAULT, // 30 seconds; the hub updates once a minute
  });

export const latencyQuery = (monitorId: string) =>
  queryOptions({
    queryFn: () => getMonitorLatency({ data: { id: monitorId } }),
    queryKey: qk.latency(monitorId),
    staleTime: QUERY_STALE_TIME.DEFAULT,
  });

export const sessionQuery = () =>
  queryOptions({
    queryFn: () => getSessionServerFn(),
    queryKey: qk.session,
    staleTime: Infinity, // Changes only on sign-in and sign-out, which reset it
  });

export const uiPrefsQuery = () =>
  queryOptions({
    queryFn: () => getUiPrefsServerFn(),
    queryKey: qk.uiPrefs,
    staleTime: Infinity, // Only changes via user action, not refetch
  });

import { useMemo } from 'react';
import type { PublicMonitor } from '@/lib/monitors';

/**
 * Creates a memoized Map of monitor IDs to monitor names
 */
export function useMonitorNameMap(monitors: PublicMonitor[]): Map<string, string> {
  return useMemo(() => {
    return new Map(monitors.map((m) => [m.id, m.name]));
  }, [monitors]);
}

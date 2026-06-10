import type { PublicMonitor } from '@/lib/monitors';

/**
 * Creates a Map of monitor IDs to monitor names.
 */
export function useMonitorNameMap(monitors: PublicMonitor[]): Map<string, string> {
  return new Map(monitors.map((m) => [m.id, m.name]));
}

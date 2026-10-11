import type { MonitorView, StatusView } from '@flarewatch/shared';

/** A view at `lastUpdate` in which each monitor is up with no incidents unless it says otherwise. */
export function statusView(
  monitors: Record<string, Partial<MonitorView>>,
  lastUpdate: number,
): StatusView {
  return {
    lastUpdate,
    monitors: Object.fromEntries(
      Object.entries(monitors).map(([id, monitor]) => [
        id,
        { status: 'up', incidents: [], ...monitor },
      ]),
    ),
  };
}

import type { MonitorView, StatusView } from '@flarewatch/shared';

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

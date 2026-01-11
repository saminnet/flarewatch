import { createServerFn } from '@tanstack/react-start';
import type { MonitorTarget } from '@flarewatch/shared';
import { getConfig } from '@/lib/config';

export type PublicMonitor = Pick<MonitorTarget, 'id' | 'name' | 'tooltip' | 'hideLatencyChart'> & {
  link?: string;
  isProxy?: boolean;
};

function deriveMonitorLink(monitor: MonitorTarget): string | undefined {
  if (monitor.link === false) return undefined;
  if (typeof monitor.link === 'string') return monitor.link;

  try {
    const url = new URL(monitor.target);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.href;
    }
  } catch {
    // Invalid URL - no link
  }
  return undefined;
}

export const getPublicMonitors = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PublicMonitor[]> => {
    const config = await getConfig();

    return config.monitors.map((monitor) => ({
      id: monitor.id,
      name: monitor.name,
      tooltip: monitor.tooltip,
      link: deriveMonitorLink(monitor),
      hideLatencyChart: monitor.hideLatencyChart,
      isProxy: Boolean(monitor.checkProxy),
    }));
  },
);

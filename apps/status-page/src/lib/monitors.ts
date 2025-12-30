import { createServerFn } from '@tanstack/react-start';
import type { MonitorTarget } from '@flarewatch/shared';

export type PublicMonitor = Pick<MonitorTarget, 'id' | 'name' | 'tooltip' | 'hideLatencyChart'> & {
  link?: string;
  isProxy?: boolean;
};

export const getPublicMonitors = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PublicMonitor[]> => {
    const { workerConfig } = await import('@flarewatch/config/worker');

    return workerConfig.monitors.map((monitor) => {
      let link: string | undefined;

      if (monitor.link === false) {
        link = undefined;
      } else if (typeof monitor.link === 'string') {
        link = monitor.link;
      } else {
        // Auto-derive for HTTP/HTTPS targets
        try {
          const url = new URL(monitor.target);
          const isHttpTarget = url.protocol === 'http:' || url.protocol === 'https:';
          link = isHttpTarget ? url.href : undefined;
        } catch {
          link = undefined;
        }
      }

      return {
        id: monitor.id,
        name: monitor.name,
        tooltip: monitor.tooltip,
        link,
        hideLatencyChart: monitor.hideLatencyChart,
        isProxy: !!monitor.checkProxy,
      };
    });
  },
);

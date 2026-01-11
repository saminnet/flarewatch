import { createServerFn } from '@tanstack/react-start';
import type { Maintenance, MonitorState } from '@flarewatch/shared';
import { KV_KEYS } from '@flarewatch/shared';
import { requireStateKv } from '@/lib/runtime-env';

/**
 * Get the monitor state from Cloudflare KV
 */
export const getMonitorState = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MonitorState | null> => {
    try {
      const kv = await requireStateKv();
      const state = await kv.get(KV_KEYS.STATE, { type: 'json' });

      if (!state) {
        console.warn('No state found in KV');
        return null;
      }

      return state as MonitorState;
    } catch (error) {
      console.error('Error fetching monitor state:', error);
      return null;
    }
  },
);

/**
 * Get all maintenances from Cloudflare KV
 */
export const getMaintenances = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Maintenance[]> => {
    try {
      const kv = await requireStateKv();
      const maintenances = await kv.get(KV_KEYS.MAINTENANCES, { type: 'json' });
      return (maintenances as Maintenance[] | null) ?? [];
    } catch (error) {
      console.error('Error fetching maintenances:', error);
      return [];
    }
  },
);

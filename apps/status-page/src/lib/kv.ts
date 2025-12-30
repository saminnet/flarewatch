import { createServerFn } from '@tanstack/react-start';
import type { Maintenance, MonitorState } from '@flarewatch/shared';
import { resolveRuntimeEnv } from '@/lib/runtime-env';

/**
 * Get the monitor state from Cloudflare KV
 */
export const getMonitorState = createServerFn({ method: 'GET' }).handler(
  async (): Promise<MonitorState | null> => {
    try {
      const env = await resolveRuntimeEnv();
      const kv = env?.FLAREWATCH_STATE;

      if (!kv) {
        console.warn('FLAREWATCH_STATE KV binding not found');
        return null;
      }

      const state = await kv.get('state', { type: 'json' });

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
      const env = await resolveRuntimeEnv();
      const kv = env?.FLAREWATCH_STATE;

      if (!kv) {
        console.warn('FLAREWATCH_STATE KV binding not found');
        return [];
      }

      const maintenances = await kv.get('maintenances', { type: 'json' });
      return (maintenances as Maintenance[] | null) ?? [];
    } catch (error) {
      console.error('Error fetching maintenances:', error);
      return [];
    }
  },
);

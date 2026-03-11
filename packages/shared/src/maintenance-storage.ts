import type { Maintenance, KvStore } from './types';
import { KV_KEYS } from './types';
import { parseMaintenances } from './config';

export async function readMaintenancesFromStorage(kv: KvStore): Promise<Maintenance[]> {
  const value = await kv.get(KV_KEYS.MAINTENANCES, { type: 'json' });
  return parseMaintenances(value);
}

export async function writeMaintenancesToStorage(
  kv: KvStore,
  maintenances: Maintenance[],
): Promise<void> {
  await kv.put(KV_KEYS.MAINTENANCES, JSON.stringify(maintenances));
}

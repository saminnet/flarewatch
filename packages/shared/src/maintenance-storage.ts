import type { Maintenance } from './types';
import { KV_KEYS } from './types';
import { parseMaintenances } from './config';

type KvListKey = { name: string };

type KvListResult = {
  cursor?: string;
  keys: KvListKey[];
  list_complete: boolean;
};

export interface MaintenanceKvStore {
  get(key: string, options?: { type?: 'json' | 'text' }): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { cursor?: string; prefix?: string }): Promise<KvListResult>;
}

export const MAINTENANCE_STORAGE = {
  ITEM_PREFIX: 'maintenance:',
  VERSION: 'v2',
  VERSION_KEY: 'maintenances:storage_version',
} as const;

export function getMaintenanceItemKey(id: string): string {
  return `${MAINTENANCE_STORAGE.ITEM_PREFIX}${id}`;
}

async function listAllKeys(kv: MaintenanceKvStore, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;

  do {
    const page = await kv.list(cursor ? { cursor, prefix } : { prefix });
    keys.push(...page.keys.map((key) => key.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return keys;
}

async function readLegacyMaintenances(kv: MaintenanceKvStore): Promise<Maintenance[]> {
  const value = await kv.get(KV_KEYS.MAINTENANCES, { type: 'json' });
  return parseMaintenances(value);
}

async function readV2Maintenances(kv: MaintenanceKvStore): Promise<Maintenance[]> {
  const keys = await listAllKeys(kv, MAINTENANCE_STORAGE.ITEM_PREFIX);
  if (keys.length === 0) return [];

  const values = await Promise.all(keys.map((key) => kv.get(key, { type: 'json' })));
  return parseMaintenances(values.filter((value) => value !== null));
}

export async function isMaintenanceStorageV2(kv: MaintenanceKvStore): Promise<boolean> {
  return (await kv.get(MAINTENANCE_STORAGE.VERSION_KEY)) === MAINTENANCE_STORAGE.VERSION;
}

export async function readMaintenancesFromStorage(kv: MaintenanceKvStore): Promise<Maintenance[]> {
  if (await isMaintenanceStorageV2(kv)) {
    return readV2Maintenances(kv);
  }

  return readLegacyMaintenances(kv);
}

export async function ensureMaintenanceStorageV2(kv: MaintenanceKvStore): Promise<Maintenance[]> {
  if (await isMaintenanceStorageV2(kv)) {
    return readV2Maintenances(kv);
  }

  const maintenances = await readLegacyMaintenances(kv);
  await Promise.all(
    maintenances.map((maintenance) =>
      kv.put(getMaintenanceItemKey(maintenance.id), JSON.stringify(maintenance)),
    ),
  );
  await kv.put(MAINTENANCE_STORAGE.VERSION_KEY, MAINTENANCE_STORAGE.VERSION);
  return maintenances;
}

export async function putMaintenanceRecord(
  kv: MaintenanceKvStore,
  maintenance: Maintenance,
): Promise<void> {
  await kv.put(getMaintenanceItemKey(maintenance.id), JSON.stringify(maintenance));
}

export async function deleteMaintenanceRecord(kv: MaintenanceKvStore, id: string): Promise<void> {
  await kv.delete(getMaintenanceItemKey(id));
}

export async function syncLegacyMaintenancesSnapshot(
  kv: MaintenanceKvStore,
  maintenances: Maintenance[],
): Promise<void> {
  await kv.put(KV_KEYS.MAINTENANCES, JSON.stringify(maintenances));
}

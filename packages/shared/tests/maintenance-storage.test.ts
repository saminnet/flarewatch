import { beforeEach, describe, expect, it } from 'vitest';
import type { Maintenance } from '../src/types';
import {
  MAINTENANCE_STORAGE,
  type MaintenanceKvStore,
  ensureMaintenanceStorageV2,
  getMaintenanceItemKey,
  readMaintenancesFromStorage,
} from '../src/maintenance-storage';
import { KV_KEYS } from '../src/types';

class MockKv {
  readonly store = new Map<string, string>();

  async get(key: string, options?: { type?: 'json' | 'text' }): Promise<unknown> {
    const value = this.store.get(key);
    if (value === undefined) return null;
    if (options?.type === 'json') {
      return JSON.parse(value) as unknown;
    }
    return value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { cursor?: string; prefix?: string }) {
    const prefix = options?.prefix ?? '';
    const keys = [...this.store.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort()
      .map((name) => ({ name }));

    return {
      keys,
      list_complete: true,
      cursor: '',
    };
  }
}

function createMaintenance(id: string): Maintenance {
  return {
    id,
    body: `Maintenance ${id}`,
    start: '2026-03-01T00:00:00.000Z',
    end: '2026-03-01T01:00:00.000Z',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('maintenance storage', () => {
  let kv: MockKv;

  beforeEach(() => {
    kv = new MockKv();
  });

  it('reads legacy array storage when v2 marker is absent', async () => {
    const legacy = [createMaintenance('legacy-1')];
    await kv.put(KV_KEYS.MAINTENANCES, JSON.stringify(legacy));

    await expect(readMaintenancesFromStorage(kv as MaintenanceKvStore)).resolves.toEqual(legacy);
  });

  it('migrates legacy array storage to v2 item keys without losing data', async () => {
    const legacy = [createMaintenance('legacy-1'), createMaintenance('legacy-2')];
    await kv.put(KV_KEYS.MAINTENANCES, JSON.stringify(legacy));

    await expect(ensureMaintenanceStorageV2(kv as MaintenanceKvStore)).resolves.toEqual(legacy);
    await expect(readMaintenancesFromStorage(kv as MaintenanceKvStore)).resolves.toEqual(legacy);
    await expect(kv.get(MAINTENANCE_STORAGE.VERSION_KEY)).resolves.toBe(
      MAINTENANCE_STORAGE.VERSION,
    );
    await expect(kv.get(getMaintenanceItemKey('legacy-1'))).resolves.toBeTruthy();
  });

  it('ignores partial v2 keys until the version marker is written', async () => {
    const legacy = [createMaintenance('legacy-1')];
    await kv.put(KV_KEYS.MAINTENANCES, JSON.stringify(legacy));
    await kv.put(getMaintenanceItemKey('partial'), JSON.stringify(createMaintenance('partial')));

    await expect(readMaintenancesFromStorage(kv as MaintenanceKvStore)).resolves.toEqual(legacy);
  });
});

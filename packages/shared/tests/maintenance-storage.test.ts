import { beforeEach, describe, expect, it } from 'vite-plus/test';
import type { Maintenance } from '../src/types';
import type { KvStore } from '../src/types';
import {
  readMaintenancesFromStorage,
  writeMaintenancesToStorage,
} from '../src/maintenance-storage';

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

  it('returns an empty list when the snapshot key is absent', async () => {
    await expect(readMaintenancesFromStorage(kv as KvStore)).resolves.toEqual([]);
  });

  it('reads a valid maintenances snapshot', async () => {
    const maintenances = [createMaintenance('maintenance-1')];
    await writeMaintenancesToStorage(kv as KvStore, maintenances);

    await expect(readMaintenancesFromStorage(kv as KvStore)).resolves.toEqual(maintenances);
  });

  it('writes the maintenance snapshot to the supported KV key', async () => {
    const maintenances = [createMaintenance('maintenance-1'), createMaintenance('maintenance-2')];
    await writeMaintenancesToStorage(kv as KvStore, maintenances);

    await expect(kv.get('maintenances', { type: 'json' })).resolves.toEqual(maintenances);
  });
});

import { vi } from 'vite-plus/test';

export function memoryKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const kv = {
    get: vi.fn(async (key: string, options?: { type?: string }) => {
      const value = store.get(key) ?? null;
      return value !== null && options?.type === 'json' ? (JSON.parse(value) as unknown) : value;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
  return kv as typeof kv & KVNamespace;
}

import { vi } from 'vite-plus/test';

export function createKv(initial: Array<[string, unknown]> = []) {
  const values = new Map<string, unknown>(initial);
  const get = vi.fn(async (key: string, options?: { type?: 'json' | 'text' }) => {
    const value = values.get(key);
    if (value === undefined) return null;
    if (options?.type === 'json' && typeof value === 'string') {
      const parsed: unknown = JSON.parse(value);
      return parsed;
    }
    return structuredClone(value);
  });
  const put = vi.fn(async (key: string, value: string) => {
    values.set(key, value);
  });

  return { get, put, values };
}

export function asKv(kv: ReturnType<typeof createKv>): KVNamespace {
  return kv as ReturnType<typeof createKv> & KVNamespace;
}

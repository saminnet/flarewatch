import { vi } from 'vite-plus/test';

type GetType = 'json' | 'text' | { type?: 'json' | 'text' };

export function createKv(initial: Array<[string, unknown]> = []) {
  const values = new Map<string, unknown>(initial);
  const get = vi.fn(async (key: string, options?: GetType) => {
    const value = values.get(key);
    if (value === undefined) return null;
    const type = typeof options === 'string' ? options : options?.type;
    if (type === 'json' && typeof value === 'string') {
      const parsed: unknown = JSON.parse(value);
      return parsed;
    }
    return structuredClone(value);
  });
  const put = vi.fn(async (key: string, value: string) => {
    values.set(key, value);
  });
  // Pages of 1,000 keys with a cursor, like KV.
  const list = vi.fn(
    async ({ prefix = '', cursor = '0' }: { prefix?: string; cursor?: string } = {}) => {
      const names = [...values.keys()].filter((name) => name.startsWith(prefix)).sort();
      const from = Number(cursor);
      const keys = names.slice(from, from + 1000).map((name) => ({ name }));
      const complete = from + 1000 >= names.length;
      return complete
        ? { keys, list_complete: true }
        : { keys, list_complete: false, cursor: String(from + 1000) };
    },
  );

  return { get, put, list, values };
}

export function asKv(kv: ReturnType<typeof createKv>): KVNamespace {
  return kv as ReturnType<typeof createKv> & KVNamespace;
}

import { describe, expect, it, vi } from 'vite-plus/test';
import { requireStateKv, resolveRuntimeEnv } from '@/lib/runtime-env';

type StateKv = Awaited<ReturnType<typeof requireStateKv>>;

describe('runtime-env', () => {
  it('prefers global __env__ when present', async () => {
    const kv = { name: 'state' } as { name: string } & StateKv;
    const env: Cloudflare.Env = { FLAREWATCH_STATE: kv };
    vi.stubGlobal('__env__', env);

    await expect(resolveRuntimeEnv()).resolves.toBe(env);
  });

  it('returns the FLAREWATCH_STATE binding', async () => {
    const kv = { name: 'state' } as { name: string } & StateKv;
    vi.stubGlobal('__env__', { FLAREWATCH_STATE: kv });

    await expect(requireStateKv()).resolves.toBe(kv);
  });

  it('throws when no state KV binding is configured', async () => {
    vi.stubGlobal('__env__', {});

    await expect(requireStateKv()).rejects.toThrow('FLAREWATCH_STATE binding not found');
  });
});

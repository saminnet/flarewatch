import { afterEach, describe, expect, it } from 'vite-plus/test';
import { requireStateKv, resolveRuntimeEnv } from '@/lib/runtime-env';

type StateKv = Awaited<ReturnType<typeof requireStateKv>>;

const originalEnv = globalThis.__env__;

afterEach(() => {
  globalThis.__env__ = originalEnv;
});

describe('runtime-env', () => {
  it('prefers global __env__ when present', async () => {
    const kv = { name: 'state' } as { name: string } & StateKv;
    const env: Cloudflare.Env = { STATE_KV: kv };
    globalThis.__env__ = env;

    await expect(resolveRuntimeEnv()).resolves.toBe(env);
  });

  it('returns STATE_KV when available', async () => {
    const kv = { name: 'state' } as { name: string } & StateKv;
    globalThis.__env__ = { STATE_KV: kv };

    await expect(requireStateKv()).resolves.toBe(kv);
  });

  it('falls back to FLAREWATCH_STATE', async () => {
    const kv = { name: 'legacy-state' } as { name: string } & StateKv;
    globalThis.__env__ = { FLAREWATCH_STATE: kv };

    await expect(requireStateKv()).resolves.toBe(kv);
  });

  it('throws when no state KV binding is configured', async () => {
    globalThis.__env__ = {};

    await expect(requireStateKv()).rejects.toThrow(
      'STATE_KV (or FLAREWATCH_STATE) binding not found',
    );
  });
});

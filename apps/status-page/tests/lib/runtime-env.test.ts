import { afterEach, describe, expect, it } from 'vite-plus/test';
import { requireStateKv, resolveRuntimeEnv } from '../../src/lib/runtime-env';

type GlobalWithEnv = typeof globalThis & { __env__?: unknown };
type StateKv = Awaited<ReturnType<typeof requireStateKv>>;

const globalWithEnv = globalThis as GlobalWithEnv;
const originalEnv = globalWithEnv.__env__;

afterEach(() => {
  if (originalEnv === undefined) {
    delete globalWithEnv.__env__;
  } else {
    globalWithEnv.__env__ = originalEnv;
  }
});

describe('runtime-env', () => {
  it('prefers global __env__ when present', async () => {
    const env = { STATE_KV: { name: 'state' } };
    globalWithEnv.__env__ = env;

    await expect(resolveRuntimeEnv()).resolves.toBe(env);
  });

  it('returns STATE_KV when available', async () => {
    const kv = { name: 'state' } as unknown as StateKv;
    globalWithEnv.__env__ = { STATE_KV: kv };

    await expect(requireStateKv()).resolves.toBe(kv);
  });

  it('falls back to FLAREWATCH_STATE', async () => {
    const kv = { name: 'legacy-state' } as unknown as StateKv;
    globalWithEnv.__env__ = { FLAREWATCH_STATE: kv };

    await expect(requireStateKv()).resolves.toBe(kv);
  });

  it('throws when no state KV binding is configured', async () => {
    globalWithEnv.__env__ = {};

    await expect(requireStateKv()).rejects.toThrow(
      'STATE_KV (or FLAREWATCH_STATE) binding not found',
    );
  });
});

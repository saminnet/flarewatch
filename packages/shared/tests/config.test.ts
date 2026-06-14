import { describe, expect, it } from 'vite-plus/test';
import {
  isStoredConfigEnvelope,
  isValidRuntimeConfig,
  loadRuntimeConfig,
  parseRuntimeConfig,
} from '../src/config';
import { KV_KEYS, type KvStore, type RuntimeConfig } from '../src/types';

class MockKv implements KvStore {
  readonly reads: Array<{ key: string; type?: 'json' | 'text' }> = [];

  constructor(private readonly value: unknown) {}

  async get(key: string, options?: { type?: 'json' | 'text' }): Promise<unknown> {
    this.reads.push({ key, ...(options?.type && { type: options.type }) });
    return this.value;
  }

  async put(): Promise<void> {
    throw new Error('put is not used by config tests');
  }
}

function createRuntimeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    monitors: [
      {
        id: 'api',
        name: 'API',
        method: 'GET',
        target: 'https://api.example.com/health',
      },
    ],
    ...overrides,
  };
}

describe('runtime config contract', () => {
  it('accepts a direct runtime config', () => {
    const config = createRuntimeConfig({
      statusPage: {
        title: 'Status',
      },
    });

    expect(isValidRuntimeConfig(config)).toBe(true);
    expect(parseRuntimeConfig(config)).toEqual(config);
  });

  it('accepts a stored config envelope with opaque external metadata', () => {
    const config = createRuntimeConfig();
    const envelope = {
      config,
      _deployment: {
        external: true,
        source: { id: 'runtime-config-writer' },
      },
      externalMetadata: {
        configVersion: '2026.06.10',
      },
    };

    expect(isStoredConfigEnvelope(envelope)).toBe(true);
    expect(parseRuntimeConfig(envelope)).toEqual(config);
  });

  it('accepts non-object envelope metadata', () => {
    const config = createRuntimeConfig();
    const envelope = {
      config,
      _deployment: 'external-owner',
    };

    expect(isStoredConfigEnvelope(envelope)).toBe(true);
    expect(parseRuntimeConfig(envelope)).toEqual(config);
  });

  it('rejects a stored config envelope when the nested config is invalid', () => {
    const envelope = {
      config: createRuntimeConfig({
        monitors: [
          {
            id: 'api',
            name: 'API',
            method: 'GET',
            target: 'not-a-url',
          },
        ],
      }),
      _deployment: { external: true },
    };

    expect(isStoredConfigEnvelope(envelope)).toBe(false);
    expect(parseRuntimeConfig(envelope)).toBeNull();
  });

  it('rejects a runtime config with an invalid monitor target', () => {
    const config = createRuntimeConfig({
      monitors: [
        {
          id: 'api',
          name: 'API',
          method: 'GET',
          target: 'not-a-url',
        },
      ],
    });

    expect(isValidRuntimeConfig(config)).toBe(false);
    expect(parseRuntimeConfig(config)).toBeNull();
  });

  it('keeps statusPage optional for OSS runtime config', () => {
    const config = createRuntimeConfig();

    expect(config.statusPage).toBeUndefined();
    expect(isValidRuntimeConfig(config)).toBe(true);
  });

  it('loads a direct runtime config from the supported KV key', async () => {
    const config = createRuntimeConfig();
    const kv = new MockKv(config);

    await expect(loadRuntimeConfig(kv)).resolves.toEqual(config);
    expect(kv.reads).toEqual([{ key: KV_KEYS.CONFIG, type: 'json' }]);
  });

  it('loads an enveloped runtime config from the supported KV key', async () => {
    const config = createRuntimeConfig();
    const kv = new MockKv({
      config,
      _deployment: {
        arbitraryExternalField: 'external-owner',
      },
    });

    await expect(loadRuntimeConfig(kv)).resolves.toEqual(config);
    expect(kv.reads).toEqual([{ key: KV_KEYS.CONFIG, type: 'json' }]);
  });
});

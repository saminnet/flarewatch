import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vite-plus/test';
import {
  isStoredConfigEnvelope,
  isValidRuntimeConfig,
  loadRuntimeConfig,
  parseRuntimeConfig,
} from '../src/config';
import { KV_KEYS, type JsonValue, type KvStore, type RuntimeConfig } from '../src/types';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

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

interface MonitorOverrides {
  id?: unknown;
  name?: unknown;
  method?: unknown;
  target?: unknown;
}

function createConfigWithMonitor(monitor: MonitorOverrides) {
  return {
    monitors: [
      {
        id: 'api',
        name: 'API',
        method: 'GET',
        target: 'https://api.example.com/health',
        ...monitor,
      },
    ],
  };
}

describe('runtime config contract', () => {
  let warn: MockInstance<Console['warn']>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('accepts a direct runtime config', () => {
    const config = createRuntimeConfig({
      statusPage: {
        title: 'Status',
      },
    });

    expect(isValidRuntimeConfig(config)).toBe(true);
    expect(parseRuntimeConfig(config)).toEqual(config);
  });

  it('accepts string webhook options and rejects numeric values', () => {
    const config = createRuntimeConfig({
      notification: {
        webhook: {
          url: 'https://hooks.example.com/webhook',
          template: 'pushover',
          options: { token: 'app-token', user: 'user-key' },
        },
      },
    });

    expect(isValidRuntimeConfig(config)).toBe(true);
    expect(
      isValidRuntimeConfig({
        ...config,
        notification: {
          webhook: {
            url: 'https://hooks.example.com/webhook',
            template: 'pushover',
            options: { token: 123 },
          },
        },
      }),
    ).toBe(false);
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

    expect(isStoredConfigEnvelope({ config, _deployment: 'external-owner' })).toBe(true);
    expect(parseRuntimeConfig({ config, _deployment: 'external-owner' })).toEqual(config);
  });

  it('rejects param and form webhook payloads that are not objects', () => {
    const configWithWebhookPayload = (
      payloadType: 'param' | 'json' | 'x-www-form-urlencoded',
      payload: JsonValue,
    ) =>
      createRuntimeConfig({
        notification: {
          webhook: { url: 'https://hooks.example.com', payloadType, payload },
        },
      });

    expect(isValidRuntimeConfig(configWithWebhookPayload('param', '$MSG'))).toBe(false);
    expect(
      isValidRuntimeConfig(configWithWebhookPayload('x-www-form-urlencoded', ['a', 'b'])),
    ).toBe(false);
    expect(isValidRuntimeConfig(configWithWebhookPayload('param', { msg: '$MSG' }))).toBe(true);
    expect(isValidRuntimeConfig(configWithWebhookPayload('json', 'plain text'))).toBe(true);
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
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"api"'));
  });

  it.each(HTTP_METHODS)('accepts %s with http and https URL targets', (method) => {
    for (const target of ['https://example.com/health', 'http://example.com/health']) {
      expect(isValidRuntimeConfig(createConfigWithMonitor({ method, target }))).toBe(true);
    }
  });

  it.each([
    [{ id: '' }, 'id must be a non-empty string'],
    [{ name: '' }, 'name must be a non-empty string'],
    [{ method: 42 }, 'method must be a string'],
    [{ target: undefined }, 'target must be a string'],
  ])('rejects a malformed monitor %j and names the rule', (overrides, rule) => {
    const config = createConfigWithMonitor(overrides);

    expect(isValidRuntimeConfig(config)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(rule));
  });

  it.each(HTTP_METHODS)('rejects %s with a non-http(s) target', (method) => {
    const config = createConfigWithMonitor({ method, target: 'example.com:443' });

    expect(isValidRuntimeConfig(config)).toBe(false);
    expect(parseRuntimeConfig(config)).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      `[Config] Rejected monitor "api": ${method} target must be an http(s) URL`,
    );
  });

  it('accepts TCP_PING with a host:port target', () => {
    const config = createConfigWithMonitor({ method: 'TCP_PING', target: 'example.com:443' });

    expect(isValidRuntimeConfig(config)).toBe(true);
  });

  it('rejects TCP_PING without a port', () => {
    const config = createConfigWithMonitor({ method: 'TCP_PING', target: 'example.com' });

    expect(isValidRuntimeConfig(config)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('TCP_PING target must be host:port'));
  });

  it('rejects an unknown method', () => {
    const config = createConfigWithMonitor({ method: 'TRACE', target: 'https://example.com' });

    expect(isValidRuntimeConfig(config)).toBe(false);
    expect(parseRuntimeConfig(config)).toBeNull();
    expect(warn).toHaveBeenCalledWith('[Config] Rejected monitor "api": unknown method "TRACE"');
  });

  it.each(['get', 'tcp_ping', 'heartbeat'])('rejects the lowercase method %s', (method) => {
    const config = createConfigWithMonitor({ method, target: 'https://example.com' });

    expect(isValidRuntimeConfig(config)).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      `[Config] Rejected monitor "api": method must be uppercase: "${method.toUpperCase()}"`,
    );
  });

  it('accepts a boolean private flag, rejects others', () => {
    const monitor = createRuntimeConfig().monitors[0]!;

    expect(isValidRuntimeConfig({ monitors: [{ ...monitor, private: true }] })).toBe(true);
    expect(isValidRuntimeConfig({ monitors: [{ ...monitor, private: 'yes' }] })).toBe(false);
  });

  it('accepts a HEARTBEAT monitor at the inclusive limits', () => {
    const config = {
      monitors: [
        {
          id: 'backup_01-prod',
          name: 'Backup',
          method: 'HEARTBEAT',
          periodSeconds: 2_678_400,
          graceSeconds: 604_800,
        },
      ],
    };

    expect(isValidRuntimeConfig(config)).toBe(true);
  });

  it.each([
    [{ periodSeconds: 59 }, 'periodSeconds'],
    [{ periodSeconds: 2_678_401 }, 'periodSeconds'],
    [{ periodSeconds: 60.5 }, 'periodSeconds'],
    [{ graceSeconds: -1 }, 'graceSeconds'],
    [{ graceSeconds: 604_801 }, 'graceSeconds'],
    [{ graceSeconds: 0.5 }, 'graceSeconds'],
    [{ id: 'backup/01' }, 'HEARTBEAT id'],
    [{ id: 'a'.repeat(65) }, 'HEARTBEAT id'],
    [{ target: 'https://example.com' }, 'must not define target'],
    [{ checkProxy: 'https://proxy.example.com' }, 'must not define checkProxy'],
  ])('rejects an invalid HEARTBEAT monitor %j', (overrides, rule) => {
    const monitor = {
      id: 'backup',
      name: 'Backup',
      method: 'HEARTBEAT',
      periodSeconds: 60,
      graceSeconds: 0,
      ...overrides,
    };

    expect(isValidRuntimeConfig({ monitors: [monitor] })).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(rule));
  });

  it('rejects duplicate monitor ids', () => {
    const monitor = {
      id: 'duplicate',
      name: 'Duplicate',
      method: 'HEARTBEAT',
      periodSeconds: 60,
      graceSeconds: 0,
    };

    expect(isValidRuntimeConfig({ monitors: [monitor, { ...monitor }] })).toBe(false);
    expect(warn).toHaveBeenCalledWith('[Config] Rejected monitor "duplicate": id must be unique');
  });

  it('loads a direct runtime config from the supported KV key', async () => {
    const config = createRuntimeConfig();
    const kv = new MockKv(config);

    await expect(loadRuntimeConfig(kv)).resolves.toEqual(config);
    expect(kv.reads).toEqual([{ key: KV_KEYS.CONFIG, type: 'json' }]);
  });

  it('returns null for an invalid KV config', async () => {
    const kv = new MockKv({ monitors: 'invalid' });

    await expect(loadRuntimeConfig(kv)).resolves.toBeNull();
  });

  it('returns null when the KV read fails', async () => {
    const kv: KvStore = {
      get: async () => {
        throw new Error('kv down');
      },
      put: async () => {},
    };

    await expect(loadRuntimeConfig(kv)).resolves.toBeNull();
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

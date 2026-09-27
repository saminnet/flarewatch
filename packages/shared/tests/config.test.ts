import { describe, expect, it } from 'vite-plus/test';
import { configIssues } from '../src/config';
import type { JsonValue, RuntimeConfig } from '../src/types';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

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

const isValid = (value: unknown) => configIssues(value).length === 0;

describe('config validation', () => {
  it('accepts a direct runtime config', () => {
    const config = createRuntimeConfig({
      statusPage: {
        title: 'Status',
      },
    });

    expect(isValid(config)).toBe(true);
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

    expect(isValid(config)).toBe(true);
    expect(
      isValid({
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

    expect(isValid(configWithWebhookPayload('param', '$MSG'))).toBe(false);
    expect(isValid(configWithWebhookPayload('x-www-form-urlencoded', ['a', 'b']))).toBe(false);
    expect(isValid(configWithWebhookPayload('param', { msg: '$MSG' }))).toBe(true);
    expect(isValid(configWithWebhookPayload('json', 'plain text'))).toBe(true);
  });

  it.each(HTTP_METHODS)('accepts %s with http and https URL targets', (method) => {
    for (const target of ['https://example.com/health', 'http://example.com/health']) {
      expect(isValid(createConfigWithMonitor({ method, target }))).toBe(true);
    }
  });

  it.each([
    [{ id: '' }, 'id must be a non-empty string'],
    [{ name: '' }, 'name must be a non-empty string'],
    [{ method: 42 }, 'method must be a string'],
    [{ target: undefined }, 'target must be a string'],
  ])('rejects a malformed monitor %j and names the rule', (overrides, rule) => {
    const config = createConfigWithMonitor(overrides);

    expect(configIssues(config).join('\n')).toContain(rule);
  });

  it.each(HTTP_METHODS)('rejects %s with a non-http(s) target', (method) => {
    const config = createConfigWithMonitor({ method, target: 'example.com:443' });

    expect(configIssues(config)).toContain(
      `monitor "api": ${method} target must be an http(s) URL`,
    );
  });

  it('accepts TCP_PING with a host:port target', () => {
    const config = createConfigWithMonitor({ method: 'TCP_PING', target: 'example.com:443' });

    expect(isValid(config)).toBe(true);
  });

  it('rejects TCP_PING without a port', () => {
    const config = createConfigWithMonitor({ method: 'TCP_PING', target: 'example.com' });

    expect(configIssues(config)).toContain(
      'monitor "api": TCP_PING target must be host:port (e.g. "example.com:443")',
    );
  });

  it('rejects an unknown method', () => {
    const config = createConfigWithMonitor({ method: 'TRACE', target: 'https://example.com' });

    expect(configIssues(config)).toContain('monitor "api": unknown method "TRACE"');
  });

  it.each(['get', 'tcp_ping', 'heartbeat'])('rejects the lowercase method %s', (method) => {
    const config = createConfigWithMonitor({ method, target: 'https://example.com' });

    expect(configIssues(config)).toContain(
      `monitor "api": method must be uppercase: "${method.toUpperCase()}"`,
    );
  });

  it('accepts a boolean private flag, rejects others', () => {
    const monitor = createRuntimeConfig().monitors[0]!;

    expect(isValid({ monitors: [{ ...monitor, private: true }] })).toBe(true);
    expect(isValid({ monitors: [{ ...monitor, private: 'yes' }] })).toBe(false);
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

    expect(isValid(config)).toBe(true);
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

    expect(configIssues({ monitors: [monitor] }).join('\n')).toContain(rule);
  });

  it('rejects duplicate monitor ids', () => {
    const monitor = {
      id: 'duplicate',
      name: 'Duplicate',
      method: 'HEARTBEAT',
      periodSeconds: 60,
      graceSeconds: 0,
    };

    expect(configIssues({ monitors: [monitor, { ...monitor }] })).toContain(
      'monitor "duplicate": id must be unique',
    );
  });
});

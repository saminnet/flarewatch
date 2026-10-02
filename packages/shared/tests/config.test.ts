import { describe, expect, it } from 'vite-plus/test';
import { configIssues, parseSecretWebhooks } from '../src/config';
import type { JsonValue, PullMonitor, RuntimeConfig } from '../src/types';

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

/** Any monitor field, of any type, plus a misspelt one. */
type MonitorOverrides = { [K in keyof PullMonitor | 'expectdCodes']?: JsonValue | undefined };

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

  it('accepts every status page field', () => {
    const config = createRuntimeConfig({
      statusPage: {
        title: 'Status',
        visibility: 'private',
        links: [{ label: 'Home', link: 'https://example.com', highlight: true }],
        group: { APIs: ['api'] },
        favicon: '/favicon.png',
        logo: 'https://example.com/logo.svg',
        apiCorsOrigins: ['https://status.example.com'],
      },
    });

    expect(configIssues(config)).toEqual([]);
  });

  it('names an unknown status page field', () => {
    const issues = configIssues({ monitors: [], statusPage: { titel: 'x' } });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('titel');
  });

  it('rejects the removed theme, customCss, themeVars and poweredByUrl fields', () => {
    const issues = configIssues({
      monitors: [],
      statusPage: {
        theme: 'ocean',
        customCss: 'body { margin: 0; }',
        themeVars: '--ring: #fff;',
        poweredByUrl: 'https://example.com',
      },
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('theme');
    expect(issues[0]).toContain('customCss');
    expect(issues[0]).toContain('themeVars');
    expect(issues[0]).toContain('poweredByUrl');
  });

  it('rejects an SVG data image and accepts a PNG one', () => {
    const issues = configIssues(
      createRuntimeConfig({ statusPage: { favicon: 'data:image/svg+xml;base64,AAAA' } }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('favicon');
    expect(
      configIssues(createRuntimeConfig({ statusPage: { logo: 'data:image/png;base64,AAAA' } })),
    ).toEqual([]);
  });

  it('accepts an https or path logo and rejects an http one, which the page cannot load', () => {
    const issues = configIssues(
      createRuntimeConfig({ statusPage: { logo: 'http://example.com/logo.png' } }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('logo');
    for (const logo of ['https://example.com/logo.png', '/logo.png']) {
      expect(configIssues(createRuntimeConfig({ statusPage: { logo } }))).toEqual([]);
    }
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
    [{ maxLatencyMs: 0 }, 'maxLatencyMs must be a positive integer'],
    [{ maxLatencyMs: -100 }, 'maxLatencyMs must be a positive integer'],
    [{ maxLatencyMs: 1.5 }, 'maxLatencyMs must be a positive integer'],
    [{ maxLatencyMs: '500' }, 'maxLatencyMs must be a positive integer'],
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
    [{ maxLatencyMs: 500 }, 'must not define maxLatencyMs'],
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

  it('accepts every HEARTBEAT field', () => {
    const config = createRuntimeConfig({
      monitors: [
        ...createRuntimeConfig().monitors,
        {
          id: 'backup',
          name: 'Backup',
          method: 'HEARTBEAT',
          periodSeconds: 3600,
          graceSeconds: 300,
          private: true,
          dependsOn: ['api'],
          reminderEveryChecks: 30,
          link: 'https://backup.example.com',
          tooltip: 'Nightly database dump',
        },
      ],
    });

    expect(configIssues(config)).toEqual([]);
  });

  it('names a misspelt HEARTBEAT field', () => {
    const monitor = {
      id: 'backup',
      name: 'Backup',
      method: 'HEARTBEAT',
      periodSeconds: 3600,
      graceSeconds: 300,
      reminderEveryCheck: 30,
    };

    expect(configIssues({ monitors: [monitor] })).toEqual([
      'monitor "backup": unknown field "reminderEveryCheck"',
    ]);
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

  it('accepts every documented monitor field', () => {
    const config = createConfigWithMonitor({
      tooltip: 'Our API',
      hideLatencyChart: true,
      expectedCodes: [200, 204],
      timeout: 5000,
      headers: { Authorization: 'Bearer x', 'X-Retry': 2 },
      body: '{}',
      method: 'POST',
      responseKeyword: 'ok',
      responseForbiddenKeyword: 'error',
      responseJsonPath: '$.data[0].status',
      responseJsonValue: null,
      responseHeaderEquals: { 'Cache-Control': 'no-store' },
      checkProxy: 'https://proxy.example.com/check',
      checkProxyFallback: true,
      confirmVia: 'globalping://TOKEN?magic=fra',
      sslCheckEnabled: true,
      sslCheckDaysBeforeExpiry: 14,
      sslIgnoreSelfSigned: false,
      link: false,
      private: true,
    });

    expect(configIssues(config)).toEqual([]);
  });

  it.each([
    [{ expectdCodes: [200] }, 'unknown field "expectdCodes"'],
    [{ expectedCodes: [200, 'x'] }, 'expectedCodes must be an integer from 100 to 599'],
    [{ responseJsonPath: 'status', responseJsonValue: 'ok' }, 'responseJsonPath must be a path'],
    [{ responseJsonPath: '$.status' }, 'responseJsonPath and responseJsonValue go together'],
    [{ responseJsonValue: 'ok' }, 'responseJsonPath and responseJsonValue go together'],
    [
      { responseJsonPath: '$.a', responseJsonValue: { ok: true } },
      'responseJsonValue must be a string, number, boolean or null',
    ],
    [{ responseHeaderEquals: { 'Bad Name': 'x' } }, 'responseHeaderEquals: bad header name'],
    [{ responseHeaderEquals: { 'X-A': 1 } }, 'responseHeaderEquals values must be strings'],
    [{ checkProxy: 'worker://local' }, 'checkProxy must be an http(s) URL or globalping://<token>'],
    [{ checkProxy: 'globalping://' }, 'checkProxy must be an http(s) URL or globalping://<token>'],
    [{ pingProtocol: 'udp' }, "pingProtocol must be 'tcp' or 'icmp'"],
    [{ confirmVia: 'worker://local' }, 'confirmVia must be an http(s) URL or globalping://<token>'],
    [
      { checkProxy: 'globalping://T?magic=fra', confirmVia: 'globalping://T?magic=fra' },
      'confirmVia must be another place than checkProxy',
    ],
  ])('rejects the monitor field %j and names the rule', (overrides, rule) => {
    expect(configIssues(createConfigWithMonitor(overrides)).join('\n')).toContain(rule);
  });

  it('never quotes a check location, which can hold a token', () => {
    const issues = configIssues(createConfigWithMonitor({ checkProxy: 'globalping:/TOKEN-1234' }));
    expect(issues).not.toEqual([]);
    expect(issues.join('\n')).not.toContain('TOKEN-1234');
  });

  describe('dependsOn', () => {
    const pull = (id: string, dependsOn?: unknown) => ({
      id,
      name: id,
      method: 'GET',
      target: `https://${id}.example.com`,
      ...(dependsOn !== undefined && { dependsOn }),
    });

    it('accepts a chain of dependencies, heartbeats included', () => {
      const job = {
        id: 'job',
        name: 'Job',
        method: 'HEARTBEAT',
        periodSeconds: 60,
        graceSeconds: 0,
        dependsOn: ['app'],
      };

      expect(configIssues({ monitors: [pull('gateway'), pull('app', ['gateway']), job] })).toEqual(
        [],
      );
    });

    it.each([
      [
        'a string',
        [pull('app', 'gateway'), pull('gateway')],
        'monitor "app": dependsOn must be a list of monitor ids',
      ],
      [
        'an unknown id',
        [pull('app', ['missing'])],
        'monitor "app": dependsOn: no monitor has id "missing"',
      ],
      ['itself', [pull('app', ['app'])], 'monitor "app": dependsOn cannot list the monitor itself'],
      [
        'a duplicate',
        [pull('app', ['gateway', 'gateway']), pull('gateway')],
        'monitor "app": dependsOn lists "gateway" twice',
      ],
      [
        'a loop',
        [pull('a', ['b']), pull('b', ['c']), pull('c', ['a'])],
        'monitor "a": dependsOn forms a loop: a → b → c → a',
      ],
    ])('rejects %s', (_case, monitors, issue) => {
      expect(configIssues({ monitors })).toContain(issue);
    });
  });

  describe('reminderEveryChecks', () => {
    const job = { id: 'job', name: 'Job', method: 'HEARTBEAT', periodSeconds: 60, graceSeconds: 0 };
    const api = { id: 'api', name: 'API', method: 'GET', target: 'https://api.example.com' };

    it('accepts 30 or more check runs on a check monitor and a heartbeat', () => {
      expect(
        configIssues({
          monitors: [
            { ...api, reminderEveryChecks: 30 },
            { ...job, reminderEveryChecks: 1440 },
          ],
        }),
      ).toEqual([]);
    });

    it.each([29, 0, 30.5, '60'])('rejects %j', (reminderEveryChecks) => {
      expect(configIssues({ monitors: [{ ...api, reminderEveryChecks }] })).toEqual([
        'monitor "api": reminderEveryChecks must be an integer of at least 30',
      ]);
    });
  });

  describe('timeZone', () => {
    it.each(['UTC', 'Europe/Helsinki', 'America/New_York'])('accepts %s', (timeZone) => {
      expect(configIssues(createRuntimeConfig({ notification: { timeZone } }))).toEqual([]);
    });

    it.each(['Europe/Helsinkii', 'Helsinki', 'GMT+2', ''])('rejects %s', (timeZone) => {
      expect(configIssues(createRuntimeConfig({ notification: { timeZone } }))).toEqual([
        'notification.timeZone: timeZone must be an IANA time zone name such as Europe/Helsinki',
      ]);
    });
  });

  describe('webhook monitors', () => {
    const monitors = [
      { id: 'api', name: 'API', method: 'GET', target: 'https://api.example.com' },
      { id: 'db', name: 'DB', method: 'TCP_PING', target: 'db.example.com:5432' },
    ];

    it('accepts ids of configured monitors, and an empty list', () => {
      expect(
        configIssues({
          monitors,
          notification: {
            webhook: [
              { url: 'https://a.example.com', monitors: ['api', 'db'] },
              { url: 'https://b.example.com', monitors: [] },
            ],
          },
        }),
      ).toEqual([]);
    });

    it.each([
      [
        'an unknown id in a list of webhooks',
        {
          webhook: [
            { url: 'https://a.example.com' },
            { url: 'https://b.example.com', monitors: ['api', 'web'] },
          ],
        },
        'notification.webhook.1.monitors: no monitor has id "web"',
      ],
      [
        'an unknown id in a single webhook',
        { webhook: { url: 'https://a.example.com', monitors: ['web'] } },
        'notification.webhook.monitors: no monitor has id "web"',
      ],
    ])('rejects %s', (_case, notification, issue) => {
      expect(configIssues({ monitors, notification })).toContain(issue);
    });

    // The webhook union reports any bad field as the whole webhook's.
    it.each([
      ['a string instead of a list', { url: 'https://a.example.com', monitors: 'api' }],
      ['a field webhooks do not have', { url: 'https://a.example.com', monitor: ['api'] }],
    ])('rejects %s', (_case, webhook) => {
      expect(configIssues({ monitors, notification: { webhook } })).toEqual([
        'notification.webhook: Invalid input',
      ]);
    });
  });

  describe('parseSecretWebhooks', () => {
    const ids = ['api', 'db'];

    it('keeps the monitors a webhook lists', () => {
      expect(
        parseSecretWebhooks(
          '[{"url": "https://a.example.com", "monitors": ["api"]}, {"url": "https://b.example.com", "monitors": []}]',
          ids,
        ),
      ).toEqual({
        webhooks: [
          { url: 'https://a.example.com', monitors: ['api'] },
          { url: 'https://b.example.com', monitors: [] },
        ],
        issues: [],
      });
    });

    it('ignores an unknown monitor id and keeps the rest of the webhook', () => {
      expect(
        parseSecretWebhooks(
          '{"url": "https://a.example.com", "monitors": ["web", "db", "T0SECRET", "cache"]}',
          ids,
        ),
      ).toEqual({
        webhooks: [{ url: 'https://a.example.com', monitors: ['db'] }],
        issues: ['webhook 1.monitors: 3 unknown monitor ids ignored'],
      });
    });

    it('ignores a field webhooks do not have and still alerts the webhook', () => {
      expect(
        parseSecretWebhooks(
          '[{"url": "https://a.example.com"}, {"url": "https://b.example.com", "monitor": ["db"]}]',
          ids,
        ),
      ).toEqual({
        webhooks: [{ url: 'https://a.example.com' }, { url: 'https://b.example.com' }],
        issues: ['webhook 2: 1 unknown field ignored'],
      });
    });

    it('drops a webhook whose monitors is not a list', () => {
      expect(
        parseSecretWebhooks('{"url": "https://a.example.com", "monitors": "db"}', ids),
      ).toEqual({
        webhooks: [],
        issues: ['webhook 1.monitors: monitors must be a list of monitor ids'],
      });
    });
  });
});

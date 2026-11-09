import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { pageConfig } from '@flarewatch/config';
import { workerConfig } from '@flarewatch/config/worker';
import type { HubView } from '@flarewatch/shared';
import { Route } from '@/routes/mcp';
import { authMiddlewareServer } from '@/server/auth-middleware';
import { readVisitorSnapshot, forgetCachedView } from '@/lib/hub-cache';
import { stubMonitorWorker } from '../helpers/bindings';
import { restoreAfterEach } from '../helpers/config';
import { forgetViewAroundEachTest } from '../helpers/snapshots';
import { memoryKv } from '../helpers/kv';
import { passwordIdentity } from '@/lib/operator.server';

const T = 1736942400;
const VERSION = '2025-11-25';
const operatorIdentity = await passwordIdentity('configured');
restoreAfterEach(workerConfig, ['monitors']);
restoreAfterEach(pageConfig, ['visibility', 'group', 'apiCorsOrigins']);
forgetViewAroundEachTest();

function fixture(): HubView {
  workerConfig.monitors = [
    { id: 'api', name: 'API', method: 'GET', target: 'https://api.test' },
    { id: 'slow', name: 'Website', method: 'GET', target: 'https://site.test', maxLatencyMs: 100 },
    { id: 'up', name: 'Docs', method: 'GET', target: 'https://docs.test' },
    { id: 'pending', name: 'New service', method: 'GET', target: 'https://new.test' },
    {
      id: 'private',
      name: 'PRIVATE',
      method: 'GET',
      target: 'https://private.test',
      private: true,
    },
  ];
  pageConfig.visibility = 'public';
  pageConfig.group = { Services: ['api', 'private'], PRIVATE: ['private'] };
  pageConfig.apiCorsOrigins = [];
  return {
    lastUpdate: T,
    monitors: {
      api: {
        status: 'down',
        startedAt: T - 1000,
        incidents: [{ start: [T - 100, T - 50], error: ['Timeout', 'HTTP 503'] }],
      },
      slow: {
        status: 'up',
        startedAt: T - 1000,
        incidents: [],
        latest: { time: T, ping: 150, loc: 'FRA' },
      },
      up: {
        status: 'up',
        startedAt: T - 1000,
        incidents: [{ start: [T - 400], end: T - 300, error: ['HTTP 502'] }],
      },
      private: {
        status: 'down',
        startedAt: T - 1000,
        incidents: [{ start: [T - 1], error: ['PRIVATE'] }],
      },
    },
    maintenances: [
      {
        id: 'mixed',
        title: 'Work',
        body: 'Router upgrade',
        start: (T + 100) * 1000,
        monitors: ['api', 'private'],
        createdAt: T * 1000,
        updatedAt: T * 1000,
      },
      {
        id: 'private',
        title: 'PRIVATE',
        body: 'PRIVATE',
        start: T * 1000,
        monitors: ['private'],
        createdAt: T * 1000,
        updatedAt: T * 1000,
      },
    ],
    announcements: [
      {
        id: 'active',
        title: 'Notice',
        body: 'Investigating API',
        createdAt: T * 1000,
        updatedAt: T * 1000,
      },
      {
        id: 'expired',
        title: 'Expired',
        body: 'Old notice',
        end: T * 1000,
        createdAt: T * 1000,
        updatedAt: T * 1000,
      },
    ],
  };
}

type Handler = (ctx: { request: Request }) => Promise<Response>;
async function send(
  body: string,
  init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {},
  path = '/mcp',
) {
  const request = new Request(`https://status.test${path}`, {
    method: 'POST',
    body,
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': VERSION,
      ...init.headers,
    },
  });
  const options = Route.options as { server?: { handlers?: Record<string, Handler> } };
  const handler = options.server?.handlers?.ANY;
  if (!handler) throw new Error('Missing MCP handler');
  const response = await authMiddlewareServer({
    request,
    pathname: path,
    next: () => handler({ request }),
  } as never);
  if (!(response instanceof Response)) throw new Error('Expected HTTP response');
  return response;
}
const rpc = (
  method: string,
  params?: unknown,
  init?: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> },
) =>
  send(
    JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) }),
    init,
  );
const call = (name: string, args: unknown = {}) => rpc('tools/call', { name, arguments: args });
const initialize = (protocolVersion = VERSION) =>
  rpc('initialize', {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0' },
  });

type ToolReply = { result: { content: { type: string; text: string }[]; isError: boolean } };
async function content(response: Response) {
  expect(response.status).toBe(200);
  const body = (await response.json()) as ToolReply;
  expect(body.result.content).toHaveLength(1);
  expect(body.result.content[0]?.type).toBe('text');
  const [json, summary, extra] = body.result.content[0]!.text.split('\n');
  expect(summary).toBeTruthy();
  expect(extra).toBeUndefined();
  const data: unknown = JSON.parse(json!);
  return { data, isError: body.result.isError };
}
async function expectError(response: Response, code: number, status = 400) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ jsonrpc: '2.0', error: { code } });
}

describe('/mcp', () => {
  let view: HubView;
  let reads: string[];
  beforeEach(() => {
    view = fixture();
    reads = [];
    stubMonitorWorker(async (url) => {
      reads.push(url);
      return Response.json(view);
    });
  });

  it('initializes without a session, acknowledges initialized, pings and refuses unsupported versions', async () => {
    const response = await initialize();
    expect(response.status).toBe(200);
    expect(response.headers.get('MCP-Session-Id')).toBeNull();
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'flarewatch', version: '1.0.0' },
      },
    });
    const notification = await send('{"jsonrpc":"2.0","method":"notifications/initialized"}');
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe('');
    expect(await (await rpc('ping')).json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect(await (await initialize('2099-01-01')).json()).toMatchObject({
      result: { protocolVersion: VERSION },
    });
    expect(await (await initialize('2025-06-18')).json()).toMatchObject({
      result: { protocolVersion: '2025-06-18' },
    });
    await expectError(
      await rpc('ping', {}, { headers: { 'MCP-Protocol-Version': '2099-01-01' } }),
      -32602,
    );
    await expectError(await rpc('initialize', { protocolVersion: VERSION }), -32602);
    const options = Route.options as { server: { handlers: { ANY: Handler } } };
    const withoutVersion = new Request('https://status.test/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"method":"ping"}',
    });
    const answered = await options.server.handlers.ANY({ request: withoutVersion });
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect(reads).toHaveLength(0);
  });

  it('lists exactly four tools with actionable schemas', async () => {
    const response = await rpc('tools/list');
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: [
          expect.objectContaining({
            name: 'get_status',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          }),
          expect.objectContaining({
            name: 'list_monitors',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          }),
          expect.objectContaining({
            name: 'get_monitor',
            inputSchema: {
              type: 'object',
              properties: { id: { type: 'string', minLength: 1 } },
              required: ['id'],
              additionalProperties: false,
            },
          }),
          expect.objectContaining({
            name: 'list_incidents',
            inputSchema: {
              type: 'object',
              properties: {
                monitorId: { type: 'string', minLength: 1 },
                limit: { type: 'integer', minimum: 1, maximum: 50, default: 50 },
              },
              additionalProperties: false,
            },
          }),
        ],
      },
    });
    expect(reads).toHaveLength(0);
  });

  it('projects status and active announcements without private monitors or maintenance scope', async () => {
    await readVisitorSnapshot();
    const result = await content(await call('get_status'));
    expect(result).toEqual({
      isError: false,
      data: {
        status: 'degraded',
        up: 1,
        degraded: 1,
        down: 1,
        updatedAt: T,
        announcements: [view.announcements[0]],
        maintenances: [{ ...view.maintenances[0], monitors: ['api'] }],
      },
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(reads).toHaveLength(1);
  });

  it('lists displayed uptime, pending state, groups and the latest open incident error', async () => {
    const result = await content(await call('list_monitors'));
    expect(result).toMatchObject({
      isError: false,
      data: {
        monitors: [
          {
            id: 'api',
            name: 'API',
            group: 'Services',
            status: 'down',
            uptime: '90.00%',
            openIncident: { start: T - 100, error: 'HTTP 503' },
          },
          { id: 'slow', group: null, status: 'degraded', uptime: '100.00%', openIncident: null },
          { id: 'up', status: 'up', uptime: '90.00%', openIncident: null },
          { id: 'pending', status: 'pending', uptime: 'Pending', openIncident: null },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('returns one monitor and at most ten newest incidents, preserving recovery and errors', async () => {
    view.monitors.api!.incidents = Array.from({ length: 12 }, (_, i) => ({
      start: [T - 200 + i],
      end: T - 199 + i,
      error: [`HTTP ${500 + i}`],
    }));
    const result = await content(await call('get_monitor', { id: 'api' }));
    expect(result).toMatchObject({
      isError: false,
      data: {
        id: 'api',
        name: 'API',
        incidents: Array.from({ length: 10 }, (_, i) => ({
          monitorId: 'api',
          start: T - 189 - i,
          end: T - 188 - i,
          error: [`HTTP ${511 - i}`],
        })),
      },
    });
  });

  it('sorts incidents across monitors, filters by ID, and caps the default and explicit limit at fifty', async () => {
    expect((await content(await call('list_incidents', { limit: 1 }))).data).toEqual({
      incidents: [{ monitorId: 'api', start: T - 100, end: null, error: ['Timeout', 'HTTP 503'] }],
    });
    expect((await content(await call('list_incidents', { monitorId: 'up' }))).data).toEqual({
      incidents: [{ monitorId: 'up', start: T - 400, end: T - 300, error: ['HTTP 502'] }],
    });
    view.monitors.api!.incidents = Array.from({ length: 60 }, (_, i) => ({
      start: [T - 200 + i],
      end: T - 199 + i,
      error: ['Timeout'],
    }));
    await forgetCachedView();
    for (const args of [{}, { limit: 50 }]) {
      expect((await content(await call('list_incidents', args))).data).toEqual({
        incidents: Array.from({ length: 50 }, (_, i) => ({
          monitorId: 'api',
          start: T - 141 - i,
          end: T - 140 - i,
          error: ['Timeout'],
        })),
      });
    }
  });

  it.each(['private', 'missing', '__proto__'])(
    'refuses unavailable monitor %s identically',
    async (id) => {
      for (const [name, args] of [
        ['get_monitor', { id }],
        ['list_incidents', { monitorId: id }],
      ] as const) {
        expect(await content(await call(name, args))).toEqual({
          isError: true,
          data: { code: 404, error: 'Monitor not found' },
        });
      }
    },
  );

  it.each([
    ['get_monitor', {}],
    ['get_monitor', { id: '' }],
    ['get_monitor', { id: 1 }],
    ['list_incidents', { limit: 51 }],
    ['list_incidents', { limit: 0 }],
    ['list_incidents', { limit: 1.5 }],
    ['list_incidents', { limit: '5' }],
    ['list_incidents', { monitorId: '' }],
    ['list_incidents', { monitorId: 1 }],
    ['get_status', { extra: true }],
    ['list_monitors', []],
    ['list_monitors', null],
    ['unknown_tool', {}],
  ])('rejects invalid arguments for %s: %j', async (name, args) => {
    await expectError(await call(name, args), -32602);
    expect(reads).toHaveLength(0);
  });

  it.each(['POST', 'GET', 'OPTIONS', 'DELETE'])(
    'returns 404 for every %s on a private page, including signed-in callers',
    async (method) => {
      pageConfig.visibility = 'private';
      stubMonitorWorker(async () => Response.json(view), {
        FLAREWATCH_ADMIN_BASIC_AUTH: 'configured',
        FLAREWATCH_STATE: memoryKv({
          'admin_session:abc': JSON.stringify({
            createdAt: 123,
            ip: null,
            identity: operatorIdentity,
          }),
        }),
      });
      for (const path of ['/mcp', '/MCP/']) {
        const response = await send(
          '{}',
          {
            method,
            body: method === 'GET' ? undefined : '{}',
            headers: { Cookie: 'flarewatch_admin_session=abc' },
          },
          path,
        );
        expect(response.status).toBe(404);
        expect(response.headers.get('Location')).toBeNull();
      }
      expect(reads).toHaveLength(0);
    },
  );

  it.each(['GET', 'PUT', 'DELETE'])('refuses %s with Allow', async (method) => {
    const response = await send('{}', { method, body: method === 'GET' ? undefined : '{}' });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST, OPTIONS');
  });

  it('rejects malformed JSON, media types and bodies over 16 KiB without trusting Content-Length', async () => {
    await expectError(await send('{'), -32700);
    await expectError(await send('hello', { headers: { 'Content-Type': 'text/plain' } }), -32600);
    const ping = '{"jsonrpc":"2.0","id":1,"method":"ping"}';
    expect((await send(ping.padEnd(16 * 1024))).status).toBe(200);
    await expectError(
      await send(ping.padEnd(16 * 1024 + 1), { headers: { 'Content-Length': '1' } }),
      -32600,
    );
    await expectError(
      await send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'ping',
          params: { text: 'é'.repeat(8192) },
        }),
      ),
      -32600,
    );
  });

  it.each([
    null,
    [],
    { jsonrpc: '1.0', id: 1, method: 'ping' },
    { jsonrpc: '2.0', id: null, method: 'ping' },
    { jsonrpc: '2.0', id: {}, method: 'ping' },
    { jsonrpc: '2.0', method: 42 },
    { jsonrpc: '2.0', id: 1, method: 'ping', params: [] },
  ])('rejects invalid envelopes %j', async (message) => {
    await expectError(await send(JSON.stringify(message)), -32600);
  });

  it('answers unknown methods and preserves a string request ID', async () => {
    await expectError(await rpc('unknown'), -32601, 200);
    expect(await (await send('{"jsonrpc":"2.0","id":"abc","method":"ping"}')).json()).toEqual({
      jsonrpc: '2.0',
      id: 'abc',
      result: {},
    });
    const notification = await send('{"jsonrpc":"2.0","method":"notifications/unknown"}');
    expect(notification.status).toBe(202);
    expect(await notification.text()).toBe('');
  });

  it('uses the API origin policy with POST preflight and protocol headers, and rejects disallowed origins', async () => {
    expect((await rpc('ping')).headers.get('Access-Control-Allow-Origin')).toBe('*');
    pageConfig.apiCorsOrigins = ['https://agent.test'];
    const response = await send('', {
      method: 'OPTIONS',
      headers: { Origin: 'https://agent.test' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://agent.test');
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
      'Content-Type, MCP-Protocol-Version',
    );
    await expectError(
      await rpc('ping', {}, { headers: { Origin: 'https://evil.test' } }),
      -32600,
      403,
    );
    expect((await rpc('ping', {}, { headers: { Origin: 'https://status.test' } })).status).toBe(
      200,
    );
  });

  it('returns a tool error when the hub is unavailable', async () => {
    stubMonitorWorker(async () => new Response('Unavailable', { status: 503 }));
    expect(await content(await call('get_status'))).toEqual({
      isError: true,
      data: { error: 'No data available' },
    });
    expect(await content(await call('get_monitor', { id: 'private' }))).toEqual({
      isError: true,
      data: { code: 404, error: 'Monitor not found' },
    });
  });
});

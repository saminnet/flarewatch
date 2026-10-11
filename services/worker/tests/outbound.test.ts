import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import { unstable_startWorker } from 'wrangler';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import type { JsonObject } from '@flarewatch/shared';

let worker: Awaited<ReturnType<typeof unstable_startWorker>>;
let origin = '';
const requested: string[] = [];

function json(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

const finished = {
  status: 'finished',
  results: [
    {
      probe: { country: 'FI', city: 'Helsinki' },
      result: { status: 'finished', statusCode: 200, rawBody: 'ok', timings: { total: 12 } },
    },
  ],
};

const server = createServer((request, response) => {
  const path = request.url ?? '';
  requested.push(path);
  if (path.startsWith('/moved')) {
    response.writeHead(302, { Location: '/elsewhere' }).end();
  } else if (path.startsWith('/dns')) {
    json(response, { Status: 0, Answer: [{ type: 1, data: '192.0.2.1' }] });
  } else if (path === '/proxy') {
    json(response, { location: 'HEL', result: { ok: true, latency: 5 }, contract: 2 });
  } else if (path === '/v1/measurements' || path === '/polled/v1/measurements') {
    json(response, { id: 'measurement-1' }, 202);
  } else if (path === '/v1/measurements/measurement-1') {
    json(response, finished);
  } else if (path === '/polled/v1/measurements/measurement-1') {
    json(response, finished, 302);
  } else {
    response.writeHead(200).end();
  }
});

beforeAll(async () => {
  worker = await unstable_startWorker({
    config: `${import.meta.dirname}/workerd/direct/wrangler.toml`,
    dev: { server: { port: 0 }, inspector: false },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server has no port');
  origin = `http://127.0.0.1:${address.port}`;
}, 60_000);

afterAll(async () => {
  server.close();
  server.closeAllConnections();
  await worker.dispose();
});

beforeEach(() => {
  requested.length = 0;
});

async function post(path: string, body: JsonObject): Promise<unknown> {
  const response = await worker.fetch(`http://worker${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return response.json();
}

const monitor = { id: 'api', name: 'API', method: 'GET', target: 'https://example.com' };

const sendAlert = (url: string, template?: string) =>
  post('/webhook', {
    webhook: { url, ...(template && { template, options: { token: 't', user: 'u' } }) },
    monitor,
  });
const checkDns = (resolver: string) =>
  post('/', { ...monitor, method: 'DNS', target: 'example.com', dnsResolver: resolver });
const checkViaProxy = (proxy: string) => post('/', { ...monitor, checkProxy: proxy });
const checkViaGlobalping = (api: string) =>
  post(`/?globalping=${encodeURIComponent(api)}`, { ...monitor, checkProxy: 'globalping://t' });

// Node's fetch takes options that workerd rejects, so these requests leave from workerd.
describe('outbound requests on workerd', () => {
  it('delivers a webhook alert', async () => {
    expect(await sendAlert(`${origin}/hook`)).toEqual({ success: true, statusCode: 200 });
    expect(requested).toEqual(['/hook']);
  });

  it('delivers a Pushover alert', async () => {
    expect(await sendAlert(`${origin}/hook`, 'pushover')).toEqual({
      success: true,
      statusCode: 200,
    });
  });

  it('runs a DNS check', async () => {
    expect(await checkDns(`${origin}/dns`)).toMatchObject({ ok: true });
  });

  it('runs a check through flarewatch-proxy', async () => {
    expect(await checkViaProxy(`${origin}/proxy`)).toEqual({ ok: true, latency: 5 });
  });

  it('runs a check through Globalping', async () => {
    expect(await checkViaGlobalping(origin)).toEqual({ ok: true, latency: 12 });
    expect(requested).toEqual(['/v1/measurements', '/v1/measurements/measurement-1']);
  });
});

// Each of these requests carries a secret, so a redirect must fail it, not send it on.
describe('outbound requests do not follow a redirect', () => {
  it.each([
    ['a webhook alert', () => sendAlert(`${origin}/moved`), { success: false, statusCode: 302 }],
    ['a DNS check', () => checkDns(`${origin}/moved`), { ok: false }],
    ['a proxy check', () => checkViaProxy(`${origin}/moved`), { ok: false }],
    ['a Globalping check', () => checkViaGlobalping(`${origin}/moved`), { ok: false }],
  ])('%s', async (_, send, result) => {
    const got = await send();
    expect(got).toMatchObject(result);
    expect(JSON.stringify(got)).toMatch(/302/);
    expect(requested).toHaveLength(1);
  });

  it('a Globalping poll', async () => {
    const got = await checkViaGlobalping(`${origin}/polled`);
    expect(got).toMatchObject({ ok: false });
    expect(JSON.stringify(got)).toMatch(/302/);
    expect(requested).toHaveLength(2);
  });
});

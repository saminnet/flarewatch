import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { text } from 'node:stream/consumers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { isJsonObject, type JsonObject, type JsonValue } from '@flarewatch/shared';
import { useDirectWorker } from './helpers/direct-worker';
import { finishedMeasurement } from './helpers/globalping';
import { close, listen } from './helpers/local-server';

interface Received {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

const worker = useDirectWorker();
let origin = '';
const received: Received[] = [];

function json(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}

const finished = finishedMeasurement({ timings: { total: 12 } });

async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = request.url ?? '';
  received.push({
    method: request.method ?? '',
    path,
    headers: Object.fromEntries(
      Object.entries(request.headers).map(([name, value]) => [name, [value].flat().join(', ')]),
    ),
    body: await text(request),
  });
  if (path.startsWith('/moved')) {
    response.writeHead(302, { Location: '/elsewhere' }).end();
  } else if (path.startsWith('/dns')) {
    json(response, { Status: 0, Answer: [{ type: 1, data: '192.0.2.1' }] });
  } else if (path === '/proxy') {
    json(response, { location: 'HEL', result: { ok: true, latency: 5 }, contract: 2 });
  } else if (path.endsWith('/api.globalping.io/v1/measurements')) {
    json(response, { id: 'measurement-1' }, 202);
  } else if (path === '/api.globalping.io/v1/measurements/measurement-1') {
    json(response, finished);
  } else if (path === '/polled/api.globalping.io/v1/measurements/measurement-1') {
    json(response, finished, 302);
  } else if (path === '/data.iana.org/rdap/dns.json') {
    json(response, {
      services: [
        [['com'], ['https://rdap.test/']],
        [['org'], ['http://rdap-plain.test/']],
      ],
    });
  } else if (path.startsWith('/rdap.test/domain/') || path.startsWith('/rdap2.test/domain/')) {
    const domain = path.split('/').pop() ?? '';
    const redirect = { 'moved.com': 'https:', 'insecure.com': 'http:' }[domain];
    if (redirect && path.startsWith('/rdap.test/')) {
      response.writeHead(302, { Location: `${redirect}//rdap2.test/domain/${domain}` }).end();
      return;
    }
    const expiry = domain === 'expired.com' ? '2000-01-01T00:00:00Z' : '2100-01-01T00:00:00Z';
    json(response, {
      objectClassName: 'domain',
      ldhName: domain.toUpperCase(),
      events: [{ eventAction: 'expiration', eventDate: expiry }],
    });
  } else {
    response.writeHead(200).end();
  }
}

const server = createServer((request, response) => void answer(request, response));

beforeAll(async () => {
  origin = `http://127.0.0.1:${await listen(server)}`;
});
afterAll(() => close(server));
beforeEach(() => {
  received.length = 0;
});

const monitor = { id: 'api', name: 'API', method: 'GET', target: 'https://example.com' };

const sendAlert = (webhook: JsonObject) => worker.post('/webhook', { webhook, monitor });
const checkDns = (resolver: string) =>
  worker.post('/', { ...monitor, method: 'DNS', target: 'example.com', dnsResolver: resolver });
const checkViaProxy = (proxy: string) => worker.post('/', { ...monitor, checkProxy: proxy });
const checkViaGlobalping = (internet: string) =>
  worker.post(`/?internet=${encodeURIComponent(internet)}`, {
    ...monitor,
    checkProxy: 'globalping://t',
  });

// Node's fetch takes options that workerd rejects, so these requests leave from workerd.
describe('outbound requests on workerd', () => {
  it('delivers a webhook alert', async () => {
    expect(await sendAlert({ url: `${origin}/hook` })).toEqual({ success: true, statusCode: 200 });
    expect(received.map(({ path }) => path)).toEqual(['/hook']);
  });

  it('runs a DNS check', async () => {
    expect(await checkDns(`${origin}/dns`)).toMatchObject({ ok: true });
  });

  it('runs a check through flarewatch-proxy', async () => {
    expect(await checkViaProxy(`${origin}/proxy`)).toEqual({ ok: true, latency: 5 });
  });

  it('runs a check through Globalping', async () => {
    expect(await checkViaGlobalping(origin)).toEqual({ ok: true, latency: 12 });
    expect(received.map(({ path }) => path)).toEqual([
      '/api.globalping.io/v1/measurements',
      '/api.globalping.io/v1/measurements/measurement-1',
    ]);
  });
});

describe('RDAP domain checks on workerd', () => {
  const checkDomain = (target: string) =>
    worker.post(`/?internet=${encodeURIComponent(origin)}`, {
      id: 'domain',
      name: 'Domain',
      method: 'DOMAIN',
      target,
    });

  it.each([
    ['passes a domain far from expiry', 'example.com', undefined],
    ['follows an HTTPS redirect to another RDAP server', 'moved.com', undefined],
    ['fails an expired domain', 'expired.com', /expired/i],
    ['refuses a redirect to HTTP', 'insecure.com', /redirect/i],
    ['refuses a TLD with only an HTTP service', 'example.org', /HTTPS/],
  ])('%s', async (_, target, error) => {
    const result = (await checkDomain(target)) as { ok: boolean; error?: string };
    expect(result.ok).toBe(error === undefined);
    if (error) expect(result.error).toMatch(error);
  });
});

function fields({ headers, body }: Received): JsonObject {
  if (headers['content-type']?.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(body));
  }
  const value: unknown = JSON.parse(body);
  if (!isJsonObject(value)) throw new Error(`The body is not a JSON object: ${body}`);
  return value;
}

function textOf(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
}

function posted(request: Received): JsonObject {
  expect(request.method).toBe('POST');
  return fields(request);
}

function chatAttachment(request: Received): void {
  const { attachments } = posted(request);
  const [attachment] = Array.isArray(attachments) ? attachments : [];
  expect(Array.isArray(attachments) ? attachments.length : 0).toBe(1);
  if (!isJsonObject(attachment)) throw new Error('The message has no attachment object');
  expect(textOf(attachment.fallback)).toContain('API');
  expect(textOf(attachment.title)).toContain('API');
  expect(attachment).not.toHaveProperty('blocks');
}

// What each provider's API needs from the request, so a template that workerd sends wrong fails here.
describe('alert channels from workerd', () => {
  it.each([
    ['slack', {}, (r: Received) => expect(textOf(posted(r).attachments)).toContain('API')],
    ['mattermost', {}, chatAttachment],
    ['rocketchat', {}, chatAttachment],
    ['googlechat', {}, (r: Received) => expect(textOf(posted(r).text)).toContain('API')],
    ['discord', {}, (r: Received) => expect(textOf(posted(r).embeds)).toContain('API')],
    ['telegram', {}, (r: Received) => expect(textOf(posted(r).text)).toContain('API')],
    [
      'teams',
      {},
      (r: Received) => {
        const body = posted(r);
        expect(body.type).toBe('message');
        expect(textOf(body.attachments)).toContain('application/vnd.microsoft.card.adaptive');
      },
    ],
    [
      'gotify',
      {},
      (r: Received) => {
        const body = posted(r);
        expect(textOf(body.title)).toContain('API');
        expect(textOf(body.message)).not.toBe('');
        expect(typeof body.priority).toBe('number');
      },
    ],
    [
      'pushover',
      { options: { token: 'app-token', user: 'user-key' } },
      (r: Received) => {
        const body = posted(r);
        expect([body.token, body.user]).toEqual(['app-token', 'user-key']);
        expect(textOf(body.title)).toContain('API');
        expect(textOf(body.message)).not.toBe('');
      },
    ],
    [
      'resend',
      {
        headers: { Authorization: 'Bearer re_key' },
        options: { from: 'alerts@status.test', to: 'ops@status.test' },
      },
      (r: Received) => {
        expect(r.headers.authorization).toBe('Bearer re_key');
        const body = posted(r);
        expect(body.from).toBe('alerts@status.test');
        expect(textOf(body.to)).toContain('ops@status.test');
        expect(textOf(body.subject)).toContain('API');
      },
    ],
    [
      'ntfy',
      {},
      (r: Received) => {
        expect(r.method).toBe('POST');
        expect(r.headers.title).toContain('API');
        expect(r.headers.priority).toMatch(/^([1-5]|min|low|default|high|max|urgent)$/);
        expect(r.body).not.toBe('');
      },
    ],
    [
      'text',
      {},
      (r: Received) => {
        expect(r.method).toBe('POST');
        expect(r.headers['content-type']).toContain('text/plain');
        expect(r.body).toContain('API');
      },
    ],
  ])('%s', async (template, extra, check) => {
    expect(await sendAlert({ url: `${origin}/hook`, template, ...extra })).toEqual({
      success: true,
      statusCode: 200,
    });
    expect(received).toHaveLength(1);
    check(received[0]!);
  });

  it('matrix PUTs a text message under a transaction id', async () => {
    const room = '/_matrix/client/v3/rooms/r/send/m.room.message';
    expect(
      await sendAlert({ url: `${origin}${room}/?access_token=t`, template: 'matrix' }),
    ).toEqual({ success: true, statusCode: 200 });
    const [request] = received;
    expect(request?.method).toBe('PUT');
    expect(request?.path).toMatch(new RegExp(`^${room}/[^/?]+\\?access_token=t$`));
    const body = fields(request!);
    expect(body.msgtype).toBe('m.text');
    expect(textOf(body.body)).toContain('API');
  });

  it('zulip sends the bot credentials of the URL as Basic auth', async () => {
    const url = `http://bot%40zulip.test:api-key@${origin.slice('http://'.length)}/api/v1/messages`;
    expect(
      await sendAlert({ url, template: 'zulip', options: { to: 'ops', topic: 'alerts' } }),
    ).toEqual({ success: true, statusCode: 200 });
    const [request] = received;
    expect(request?.headers.authorization).toBe(`Basic ${btoa('bot@zulip.test:api-key')}`);
    const body = posted(request!);
    expect([body.to, body.topic]).toEqual(['ops', 'alerts']);
    expect(textOf(body.content)).toContain('API');
  });
});

// Each of these requests carries a secret, so a redirect must fail it, not send it on.
describe('outbound requests do not follow a redirect', () => {
  it.each([
    [
      'a webhook alert',
      () => sendAlert({ url: `${origin}/moved` }),
      { success: false, statusCode: 302 },
    ],
    ['a DNS check', () => checkDns(`${origin}/moved`), { ok: false }],
    ['a proxy check', () => checkViaProxy(`${origin}/moved`), { ok: false }],
    ['a Globalping check', () => checkViaGlobalping(`${origin}/moved`), { ok: false }],
  ])('%s', async (_, send, result) => {
    const got = await send();
    expect(got).toMatchObject(result);
    expect(JSON.stringify(got)).toMatch(/302/);
    expect(received).toHaveLength(1);
  });

  it('a Globalping poll', async () => {
    const got = await checkViaGlobalping(`${origin}/polled`);
    expect(got).toMatchObject({ ok: false });
    expect(JSON.stringify(got)).toMatch(/302/);
    expect(received).toHaveLength(2);
  });
});

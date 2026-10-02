import type { HeartbeatMonitor, WorkerConfig } from '@flarewatch/shared';
import { createLogger, timingSafeEqual } from '@flarewatch/shared';
import { getHub, type Env } from './env';
import type { PingKind } from './hub/heartbeat';
import { stripControlChars } from './notifications/templates/format';

const log = createLogger('Ping');

const PING_PREFIX = '/ping/';
const PING_URL_PREFIX = '/ping-url/';
const TOKEN_VERSION = 'v1';
const TOKEN_LENGTH = 32;
const MAX_BODY_BYTES = 1024;
const MAX_MESSAGE_CHARS = 200;

const RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

const encoder = new TextEncoder();

function notFound(): Response {
  return new Response('Not Found', { status: 404, headers: RESPONSE_HEADERS });
}

function base64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_');
}

/** Stable per-monitor token. Rotating HEARTBEAT_SECRET invalidates every ping URL. */
export async function deriveHeartbeatToken(secret: string, id: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${TOKEN_VERSION}:${id}`));
  return base64Url(mac).slice(0, TOKEN_LENGTH);
}

function findHeartbeatMonitor(config: WorkerConfig, id: string): HeartbeatMonitor | undefined {
  return config.monitors.find(
    (monitor): monitor is HeartbeatMonitor => monitor.id === id && monitor.method === 'HEARTBEAT',
  );
}

async function readBodyCapped(request: Request): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let received = 0;
  for (;;) {
    const chunk: ReadableStreamReadResult<unknown> = await reader.read();
    if (chunk.done) return text + decoder.decode();
    const value = chunk.value;
    if (!(value instanceof Uint8Array)) throw new TypeError('Expected a byte stream body');
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      reader.cancel().catch(() => undefined);
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

const EXIT_STATUS = /^\d{1,3}$/;

export async function handlePing(
  request: Request,
  env: Env,
  config: WorkerConfig,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  const segments = pathname.slice(PING_PREFIX.length).split('/');
  if (segments.length < 2 || segments.length > 3) return notFound();
  const id = segments[0] ?? '';
  const token = segments[1] ?? '';
  const action = segments[2] ?? '';

  // Fixed work before any monitor or KV lookup: derive the expected token for
  // the id and compare in constant time, so responses never reveal whether an
  // id or token exists.
  const secret = env.HEARTBEAT_SECRET;
  const expected = secret ? await deriveHeartbeatToken(secret, id) : null;
  if (!expected || !token || !timingSafeEqual(expected, token)) return notFound();
  const monitor = findHeartbeatMonitor(config, id);
  if (!monitor) return notFound();

  const method = request.method;
  let kind: PingKind;
  let message: string | undefined;

  if (action === '') {
    if (method !== 'GET' && method !== 'POST' && method !== 'HEAD') return notFound();
    kind = 'success';
  } else if (action === 'start') {
    if (method !== 'GET' && method !== 'POST') return notFound();
    kind = 'start';
  } else if (action === 'fail') {
    if (method !== 'POST') return notFound();
    const body = await readBodyCapped(request);
    if (body === null) {
      log.info('Ping body too large', { monitor: id });
      return new Response('Payload Too Large', { status: 413, headers: RESPONSE_HEADERS });
    }
    kind = 'fail';
    message = stripControlChars(body).slice(0, MAX_MESSAGE_CHARS);
  } else if (EXIT_STATUS.test(action) && Number(action) <= 255) {
    if (method !== 'GET' && method !== 'POST') return notFound();
    const code = Number(action);
    if (code === 0) {
      kind = 'success';
    } else {
      kind = 'fail';
      message = `exit ${code}`;
    }
  } else {
    return notFound();
  }

  const limiter = env.HEARTBEAT_RATE_LIMIT;
  if (!limiter) {
    log.error('HEARTBEAT_RATE_LIMIT binding not found', { monitor: id });
    return new Response('HEARTBEAT_RATE_LIMIT binding not found', {
      status: 503,
      headers: RESPONSE_HEADERS,
    });
  }
  const outcome = await limiter.limit({ key: id });
  if (!outcome.success) {
    log.info('Ping rate limited', { monitor: id });
    return new Response('Too Many Requests', { status: 429, headers: RESPONSE_HEADERS });
  }

  await getHub(env).ping(monitor, kind, Math.floor(Date.now() / 1000), message);
  log.info('Ping recorded', { monitor: id, signal: kind });

  return new Response(method === 'HEAD' ? null : 'OK', {
    status: 200,
    headers: { ...RESPONSE_HEADERS, 'Content-Type': 'text/plain' },
  });
}

/** Binding-only helper for the status page: builds the ping URL for one monitor. */
export async function handlePingUrl(
  request: Request,
  env: Env,
  config: WorkerConfig,
): Promise<Response> {
  const url = new URL(request.url);
  const id = url.pathname.slice(PING_URL_PREFIX.length);
  if (request.method !== 'GET' || !id || id.includes('/') || !findHeartbeatMonitor(config, id)) {
    return Response.json({ error: 'Not Found' }, { status: 404 });
  }
  if (!env.HEARTBEAT_SECRET) {
    return Response.json({ error: 'HEARTBEAT_SECRET is not configured' }, { status: 500 });
  }

  const token = await deriveHeartbeatToken(env.HEARTBEAT_SECRET, id);
  const origin = env.PUBLIC_ORIGIN || url.origin;
  log.info('Ping URL built', { monitor: id });

  return Response.json({ url: `${origin}/ping/${id}/${token}` });
}

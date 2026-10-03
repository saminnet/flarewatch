import type {
  CheckFailure,
  CheckSuccess,
  JsonObject,
  MonitorTarget,
  SSLCertificateInfo,
} from './types';

export const DEFAULT_HTTP_TIMEOUT = 10000;
export const DEFAULT_SSL_EXPIRY_THRESHOLD_DAYS = 30;

/**
 * Narrow a `JSON.parse` result to an object so its properties can be read directly. Only sound for
 * values that really came from JSON; runtime bindings and class instances are not JSON objects.
 */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** HeadersInit is string-valued, so configured numeric header values are converted. */
export function toHeaders(headers?: { [key: string]: string | number }): Headers {
  return new Headers(Object.entries(headers ?? {}).map(([key, value]) => [key, String(value)]));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sep 16, 07:02 UTC": the same shape the status page uses for timestamps. */
export function formatUtcShort(seconds: number): string {
  const d = new Date(seconds * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${hh}:${mm} UTC`;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A check's error as the page shows it. The runtime's "internal error" carries a reference for its own logs. */
export function publicErrorMessage(message: string): string {
  return message.startsWith('internal error') ? 'Connection failed' : message;
}

export function isTimeoutError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('timeout') || lower.includes('timed out') || lower.includes('abort');
}

export interface FetchOptions extends Omit<RequestInit, 'signal' | 'body'> {
  timeout?: number;
  body?: BodyInit | null | undefined;
}

/** The HTTP seam every checker and notifier takes, so tests substitute a real function. */
export type Fetcher = (url: string, options?: FetchOptions) => Promise<Response>;

function getTimeoutSignal(timeoutMs: number) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(timeoutMs), cleanup: () => {} };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cleanup: () => clearTimeout(timeoutId) };
}

/** fetch() with a timeout (default 10s); throws the runtime's abort exception when the signal fires. */
export async function fetchWithTimeout(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeout = DEFAULT_HTTP_TIMEOUT, body, ...rest } = options;

  const { signal, cleanup } = getTimeoutSignal(timeout);
  const requestInit: RequestInit = { ...rest, signal };

  // Only set body if explicitly provided (undefined !== omitted in fetch API)
  if (body !== undefined) {
    requestInit.body = body;
  }

  try {
    return await fetch(url, requestInit);
  } finally {
    cleanup();
  }
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/** A body is read this far and no further: a monitored site must not be able to exhaust the Worker's memory. */
export const MAX_BODY_BYTES = 1024 * 1024;

const JSON_PATH = /^\$(?:\.[^.[\]]+|\[\d+\])*$/;

/** The keys of a `$.a.b[0].c` path, or null when the path is not in that syntax. */
export function jsonPathKeys(path: string): (string | number)[] | null {
  if (!JSON_PATH.test(path)) return null;
  return [...path.matchAll(/\.([^.[\]]+)|\[(\d+)\]/g)].map(
    ([, key, index]) => key ?? Number(index),
  );
}

/** The value at these keys, or undefined when one is missing. Never reads inherited properties. */
function valueAt(document: unknown, keys: (string | number)[]): unknown {
  let value = document;
  for (const key of keys) {
    if (typeof key === 'number') {
      if (!Array.isArray(value)) return undefined;
      const items: unknown[] = value;
      value = items[key];
    } else {
      if (!isJsonObject(value) || !Object.hasOwn(value, key)) return undefined;
      value = value[key];
    }
  }
  return value;
}

/** A Request or a Response. */
type WithBody = Pick<Body, 'body'>;

/** Stops at maxBytes and cancels the rest, for a body whose size we do not control. */
export async function readTextUpTo(message: WithBody, maxBytes: number): Promise<string> {
  const reader = message.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  while (bytes < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value.subarray(0, maxBytes - bytes);
    bytes += chunk.byteLength;
    text += decoder.decode(chunk, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return text + decoder.decode();
}

/** JSON from a sender whose body size we do not control. Throws past maxBytes. */
export async function readJsonUpTo(message: WithBody, maxBytes: number): Promise<unknown> {
  const text = await readTextUpTo(message, maxBytes + 1);
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error(`response is over ${maxBytes} bytes`);
  }
  return JSON.parse(text);
}

/** What a check saw: a Response, or a status and body that a remote probe reported. */
export interface HttpReply {
  status: number;
  headers?: Headers;
  /** A stream is read up to the body cap; a string is taken as it is. */
  body: WithBody['body'] | string;
}

/** The first way the reply fails the monitor's assertions, or null. Never quotes the response. */
export async function validateHttpResponse(
  monitor: MonitorTarget,
  reply: HttpReply,
): Promise<string | null> {
  const { expectedCodes, responseKeyword, responseForbiddenKeyword, responseJsonPath } = monitor;
  const { status } = reply;

  if (expectedCodes) {
    if (!expectedCodes.includes(status)) {
      return `Expected status ${expectedCodes.join('|')}, got ${status}`;
    }
  } else if (status < 200 || status > 299) {
    return `Expected 2xx status, got ${status}`;
  }

  for (const [name, expected] of Object.entries(monitor.responseHeaderEquals ?? {})) {
    const actual = reply.headers?.get(name);
    if (actual == null) return `Header "${name}" not found in response`;
    if (actual !== expected) return `Header "${name}" does not have the expected value`;
  }

  // Status and headers first: they avoid reading the body.
  if (!responseKeyword && !responseForbiddenKeyword && responseJsonPath === undefined) return null;
  const body =
    typeof reply.body === 'string'
      ? reply.body
      : await readTextUpTo({ body: reply.body }, MAX_BODY_BYTES);

  if (responseKeyword && !body.includes(responseKeyword)) {
    return `Required keyword "${responseKeyword}" not found in response`;
  }

  if (responseForbiddenKeyword && body.includes(responseForbiddenKeyword)) {
    return `Forbidden keyword "${responseForbiddenKeyword}" found in response`;
  }

  if (responseJsonPath !== undefined) {
    // A body that fills the cap may have been cut short, and a cut body is not the JSON sent.
    if (new TextEncoder().encode(body).byteLength >= MAX_BODY_BYTES) {
      return `Response is too large to check ${responseJsonPath}`;
    }
    const keys = jsonPathKeys(responseJsonPath);
    if (!keys) return `responseJsonPath ${responseJsonPath} is not a $.a.b[0] path`;
    let document: unknown;
    try {
      document = JSON.parse(body);
    } catch {
      return 'Response is not valid JSON';
    }
    const value = valueAt(document, keys);
    if (value === undefined) return `JSON path ${responseJsonPath} not found in response`;
    if (value !== monitor.responseJsonValue) {
      return `JSON value at ${responseJsonPath} is not ${JSON.stringify(monitor.responseJsonValue)}`;
    }
  }

  return null;
}

interface TcpTarget {
  hostname: string;
  port: number;
}

export function parseTcpTarget(target: string): TcpTarget {
  const url = new URL(`tcp://${target}`);
  if (!url.hostname) {
    throw new Error('Invalid TCP target hostname');
  }

  if (!url.port) {
    throw new Error('TCP target must include a port (hostname:port)');
  }

  const port = Number(url.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid TCP port: ${url.port}`);
  }

  return {
    hostname: url.hostname,
    port,
  };
}

export function success(latency: number, ssl?: SSLCertificateInfo): CheckSuccess {
  if (ssl) {
    return { ok: true, latency, ssl };
  }
  return { ok: true, latency };
}

export function failure(error: string, latency?: number): CheckFailure {
  if (latency !== undefined) {
    return { ok: false, error, latency };
  }
  return { ok: false, error };
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function createLogger(component: string) {
  const log = (level: LogLevel, message: string, data?: JsonObject) => {
    // `data` spreads first so a caller can add fields but never overwrite the envelope.
    const entry = {
      ...data,
      level,
      message,
      timestamp: new Date().toISOString(),
      component,
    };
    const output = JSON.stringify(entry);

    switch (level) {
      case 'debug':
        console.debug(output);
        break;
      case 'info':
        console.info(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'error':
        console.error(output);
        break;
    }
  };

  return {
    debug: (message: string, data?: JsonObject) => log('debug', message, data),
    info: (message: string, data?: JsonObject) => log('info', message, data),
    warn: (message: string, data?: JsonObject) => log('warn', message, data),
    error: (message: string, data?: JsonObject) => log('error', message, data),
  };
}

/** Consumes the same work regardless of match, so timing cannot leak the strings. */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);

  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLen; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

/** https, or plain http on a loopback address, where nothing crosses the network. */
export function isSecureUrl(value: string): boolean {
  const url = URL.parse(value);
  if (url?.protocol === 'https:') return true;
  return url?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

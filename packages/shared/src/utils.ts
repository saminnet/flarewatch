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

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    // AbortSignal.timeout() handles cleanup automatically
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

interface HttpValidationConfig {
  expectedCodes?: number[] | undefined;
  responseKeyword?: string | undefined;
  responseForbiddenKeyword?: string | undefined;
}

/** Validation shared by the direct HTTP checker and GlobalPing. */
export function validateHttpStatusAndBody(
  status: number,
  body: string | undefined,
  config: HttpValidationConfig,
): string | null {
  const { expectedCodes, responseKeyword, responseForbiddenKeyword } = config;

  if (expectedCodes) {
    if (!expectedCodes.includes(status)) {
      return `Expected status ${expectedCodes.join('|')}, got ${status}`;
    }
  } else if (status < 200 || status > 299) {
    return `Expected 2xx status, got ${status}`;
  }

  if (body !== undefined) {
    if (responseKeyword && !body.includes(responseKeyword)) {
      return `Required keyword "${responseKeyword}" not found in response`;
    }

    if (responseForbiddenKeyword && body.includes(responseForbiddenKeyword)) {
      return `Forbidden keyword "${responseForbiddenKeyword}" found in response`;
    }
  }

  return null;
}

export async function validateHttpResponse(
  monitor: MonitorTarget,
  response: Response,
): Promise<string | null> {
  const { expectedCodes, responseKeyword, responseForbiddenKeyword } = monitor;

  // Status first: it avoids reading the body.
  const statusError = validateHttpStatusAndBody(response.status, undefined, { expectedCodes });
  if (statusError) {
    return statusError;
  }

  if (responseKeyword || responseForbiddenKeyword) {
    const body = await response.text();
    return validateHttpStatusAndBody(response.status, body, {
      expectedCodes,
      responseKeyword,
      responseForbiddenKeyword,
    });
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

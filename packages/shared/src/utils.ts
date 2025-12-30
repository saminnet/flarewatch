import type { MonitorTarget, SSLCertificateInfo, CheckSuccess, CheckFailure } from './types';

export const DEFAULT_HTTP_TIMEOUT = 10000;
export const DEFAULT_SSL_EXPIRY_THRESHOLD_DAYS = 30;

export interface FetchOptions extends Omit<RequestInit, 'signal' | 'body'> {
  timeout?: number;
  body?: BodyInit | null | undefined;
}

function getTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const abortSignalGlobal: unknown = typeof AbortSignal === 'undefined' ? undefined : AbortSignal;
  const timeoutFn = (abortSignalGlobal as { timeout?: (ms: number) => AbortSignal } | undefined)
    ?.timeout;
  if (typeof timeoutFn === 'function') {
    // AbortSignal.timeout() handles cleanup automatically
    return { signal: timeoutFn(timeoutMs), cleanup: () => {} };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cleanup: () => clearTimeout(timeoutId) };
}

/**
 * Fetch with automatic timeout handling.
 * Works in both Node.js and Cloudflare Workers.
 *
 * @param url - The URL to fetch
 * @param options - Fetch options including optional timeout (default: 10000ms)
 * @returns The fetch Response
 * @throws AbortError if the request times out
 */
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

/**
 * Error thrown when an operation times out.
 */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Wrap any promise with a timeout.
 *
 * @param promise - The promise to wrap
 * @param ms - Timeout in milliseconds
 * @returns The resolved value of the promise
 * @throws TimeoutError if the promise doesn't resolve in time
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

export interface HttpValidationConfig {
  expectedCodes?: number[] | undefined;
  responseKeyword?: string | undefined;
  responseForbiddenKeyword?: string | undefined;
}

/**
 * Validate HTTP status code and body against configuration.
 * Core validation logic shared between direct HTTP checks and GlobalPing.
 *
 * @param status - HTTP status code
 * @param body - Response body text (undefined to skip keyword checks)
 * @param config - Validation configuration
 * @returns Error message if validation fails, null if success
 */
export function validateHttpStatusAndBody(
  status: number,
  body: string | undefined,
  config: HttpValidationConfig,
): string | null {
  const { expectedCodes, responseKeyword, responseForbiddenKeyword } = config;

  // Check status code
  if (expectedCodes) {
    if (!expectedCodes.includes(status)) {
      return `Expected status ${expectedCodes.join('|')}, got ${status}`;
    }
  } else if (status < 200 || status > 299) {
    return `Expected 2xx status, got ${status}`;
  }

  // Check keywords if body is available and keywords are configured
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

/**
 * Validate HTTP response against monitor configuration.
 *
 * @param monitor - Monitor target with validation settings
 * @param response - Fetch Response to validate
 * @returns Error message if validation fails, null if success
 */
export async function validateHttpResponse(
  monitor: MonitorTarget,
  response: Response,
): Promise<string | null> {
  const { expectedCodes, responseKeyword, responseForbiddenKeyword } = monitor;

  // Check status code first (doesn't need body)
  const statusError = validateHttpStatusAndBody(response.status, undefined, { expectedCodes });
  if (statusError) {
    return statusError;
  }

  // Check keywords if configured (requires reading body)
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

/**
 * Parse TCP target string into hostname and port.
 *
 * @param target - Target in "hostname:port" format
 * @returns Object with hostname and port
 * @throws Error if hostname is missing, port is missing, or port is invalid
 */
export function parseTcpTarget(target: string): { hostname: string; port: number } {
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

/**
 * Create a successful check result.
 *
 * @param latency - Response latency in milliseconds
 * @param ssl - Optional SSL certificate information
 * @returns CheckSuccess result object
 */
export function success(latency: number, ssl?: SSLCertificateInfo): CheckSuccess {
  if (ssl) {
    return { ok: true, latency, ssl };
  }
  return { ok: true, latency };
}

/**
 * Create a failed check result.
 *
 * @param error - Error message describing the failure
 * @param latency - Optional response latency in milliseconds
 * @returns CheckFailure result object
 */
export function failure(error: string, latency?: number): CheckFailure {
  if (latency !== undefined) {
    return { ok: false, error, latency };
  }
  return { ok: false, error };
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

/**
 * Create a structured logger for a specific component.
 *
 * @param component - Component name (e.g., "Worker", "HTTP", "TCP")
 * @returns Logger object with debug, info, warn, error methods
 */
export function createLogger(component: string) {
  const log = (level: LogLevel, message: string, data?: Record<string, unknown>) => {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      component,
      ...data,
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
    debug: (message: string, data?: Record<string, unknown>) => log('debug', message, data),
    info: (message: string, data?: Record<string, unknown>) => log('info', message, data),
    warn: (message: string, data?: Record<string, unknown>) => log('warn', message, data),
    error: (message: string, data?: Record<string, unknown>) => log('error', message, data),
  };
}

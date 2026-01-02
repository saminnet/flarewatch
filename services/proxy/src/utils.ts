import type { CheckFailure, CheckSuccess, MonitorTarget, SSLCertificateInfo } from './types';

export const DEFAULT_HTTP_TIMEOUT = 10000;
export const DEFAULT_SSL_EXPIRY_THRESHOLD_DAYS = 30;

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

function getTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const abortSignalGlobal: unknown = typeof AbortSignal === 'undefined' ? undefined : AbortSignal;
  const timeoutFn = (abortSignalGlobal as { timeout?: (ms: number) => AbortSignal } | undefined)
    ?.timeout;
  if (typeof timeoutFn === 'function') {
    return { signal: timeoutFn(timeoutMs), cleanup: () => {} };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cleanup: () => clearTimeout(timeoutId) };
}

export async function fetchWithTimeout(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeout = DEFAULT_HTTP_TIMEOUT, body, ...rest } = options;

  const { signal, cleanup } = getTimeoutSignal(timeout);
  const requestInit: RequestInit = { ...rest, signal };

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
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}

interface HttpValidationConfig {
  expectedCodes?: number[] | undefined;
  responseKeyword?: string | undefined;
  responseForbiddenKeyword?: string | undefined;
}

function validateHttpStatusAndBody(
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

  const statusError = validateHttpStatusAndBody(response.status, undefined, { expectedCodes });
  if (statusError) {
    return statusError;
  }

  if (responseKeyword || responseForbiddenKeyword) {
    const body = await response.text();
    return validateHttpStatusAndBody(response.status, body, {
      expectedCodes,
      responseForbiddenKeyword,
      responseKeyword,
    });
  }

  return null;
}

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

  return { hostname: url.hostname, port };
}

export function success(latency: number, ssl?: SSLCertificateInfo): CheckSuccess {
  if (ssl) {
    return { latency, ok: true, ssl };
  }
  return { latency, ok: true };
}

export function failure(error: string, latency?: number): CheckFailure {
  if (latency !== undefined) {
    return { error, latency, ok: false };
  }
  return { error, ok: false };
}

import {
  type MonitorTarget,
  type CheckResult,
  type MonitorChecker,
  type FetchOptions,
  type Fetcher,
  success,
  failure,
  fetchWithTimeout,
  validateHttpResponse,
  DEFAULT_HTTP_TIMEOUT,
  createLogger,
  getErrorMessage,
  publicErrorMessage,
  isTimeoutError,
  toHeaders,
} from '@flarewatch/shared';

const log = createLogger('HTTP');

const USER_AGENT = 'FlareWatch/1.0 (+https://github.com/saminnet/flarewatch)';

interface CloudflareFetchOptions extends FetchOptions {
  cf?: {
    cacheTtlByStatus?: Record<string, number>;
  };
}

const MAX_REDIRECTS = 20;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const BODY_HEADERS = ['content-encoding', 'content-language', 'content-location', 'content-type'];
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

export class HttpChecker implements MonitorChecker {
  constructor(private readonly fetcher: Fetcher = fetchWithTimeout) {}

  async check(target: MonitorTarget): Promise<CheckResult> {
    const startTime = performance.now();

    try {
      const headers = toHeaders(target.headers);
      if (!headers.has('user-agent')) {
        headers.set('user-agent', USER_AGENT);
      }

      const response = await this.follow(target, headers, startTime);
      if (typeof response === 'string') return failure(response, elapsed(startTime));

      const latency = elapsed(startTime);
      log.info('Response', { name: target.name, status: response.status, latency });

      const validationError = await validateHttpResponse(target, response);

      try {
        await response.body?.cancel();
      } catch {
        // ignore: cancellation failing here is harmless
      }

      if (validationError) {
        log.info('Validation failed', { name: target.name, error: validationError });
        return failure(validationError, latency);
      }

      return success(latency);
    } catch (error) {
      const latency = elapsed(startTime);
      const errorMessage = getErrorMessage(error);

      if (isTimeoutError(errorMessage)) {
        log.info('Timeout', { name: target.name, latency });
        return failure(`Timeout after ${target.timeout || DEFAULT_HTTP_TIMEOUT}ms`, latency);
      }

      log.info('Error', { name: target.name, error: errorMessage });
      return failure(publicErrorMessage(errorMessage), latency);
    }
  }

  /**
   * The runtime would follow redirects itself, but it keeps Cookie and
   * Proxy-Authorization for another origin. This applies the fetch rules
   * instead, and gives the error text when a redirect cannot be followed.
   */
  private async follow(
    target: MonitorTarget,
    headers: Headers,
    startTime: number,
  ): Promise<Response | string> {
    const timeout = target.timeout || DEFAULT_HTTP_TIMEOUT;
    let url = target.target;
    let method = target.method || 'GET';
    let body = target.body;
    for (let hops = 0; ; hops++) {
      const response = await this.fetcher(url, {
        method,
        headers,
        body,
        timeout: Math.max(1, Math.round(timeout - (performance.now() - startTime))),
        redirect: 'manual',
        cf: {
          cacheTtlByStatus: { '100-599': -1 }, // Never cache
        },
      } satisfies CloudflareFetchOptions);
      const location = response.headers.get('location');
      if (!REDIRECTS.has(response.status) || location === null) return response;
      await response.body?.cancel();
      if (hops === MAX_REDIRECTS) return 'Too many redirects';
      const next = new URL(location, url);
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return `Redirect to a ${next.protocol} URL`;
      }
      if (next.username || next.password) {
        return 'Redirect to a URL with a username or password';
      }
      if (next.origin !== new URL(url).origin) {
        for (const name of CREDENTIAL_HEADERS) headers.delete(name);
      }
      const toGet =
        ((response.status === 301 || response.status === 302) && method === 'POST') ||
        (response.status === 303 && method !== 'GET' && method !== 'HEAD');
      if (toGet) {
        method = 'GET';
        body = undefined;
        for (const name of BODY_HEADERS) headers.delete(name);
      }
      url = next.href;
    }
  }
}

export const httpChecker = new HttpChecker();

function elapsed(startTime: number): number {
  return Math.round(performance.now() - startTime);
}

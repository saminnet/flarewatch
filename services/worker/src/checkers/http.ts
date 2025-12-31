import {
  type MonitorTarget,
  type CheckResult,
  type MonitorChecker,
  type FetchOptions,
  success,
  failure,
  fetchWithTimeout,
  validateHttpResponse,
  DEFAULT_HTTP_TIMEOUT,
  createLogger,
  getErrorMessage,
  isTimeoutError,
} from '@flarewatch/shared';

const log = createLogger('HTTP');

const USER_AGENT = 'FlareWatch/1.0 (+https://github.com/saminnet/flarewatch)';

/** Cloudflare-specific fetch options */
interface CloudflareFetchOptions extends FetchOptions {
  cf?: {
    cacheTtlByStatus?: Record<string, number>;
  };
}

export class HttpChecker implements MonitorChecker {
  async check(target: MonitorTarget): Promise<CheckResult> {
    const startTime = performance.now();

    try {
      const headers = new Headers(target.headers as HeadersInit);
      if (!headers.has('user-agent')) {
        headers.set('user-agent', USER_AGENT);
      }

      const options: CloudflareFetchOptions = {
        method: target.method || 'GET',
        headers,
        body: target.body,
        timeout: target.timeout || DEFAULT_HTTP_TIMEOUT,
        cf: {
          cacheTtlByStatus: { '100-599': -1 }, // Never cache
        },
      };
      const response = await fetchWithTimeout(target.target, options);

      const latency = Math.round(performance.now() - startTime);
      log.info('Response', { name: target.name, status: response.status, latency });

      const validationError = await validateHttpResponse(target, response);

      try {
        await response.body?.cancel();
      } catch {
        // Ignore cancellation errors
      }

      if (validationError) {
        log.info('Validation failed', { name: target.name, error: validationError });
        return failure(validationError, latency);
      }

      return success(latency);
    } catch (error) {
      const latency = Math.round(performance.now() - startTime);
      const errorMessage = getErrorMessage(error);

      if (isTimeoutError(errorMessage)) {
        log.info('Timeout', { name: target.name, latency });
        return failure(`Timeout after ${target.timeout || DEFAULT_HTTP_TIMEOUT}ms`, latency);
      }

      log.info('Error', { name: target.name, error: errorMessage });
      return failure(errorMessage, latency);
    }
  }
}

/** Singleton instance */
export const httpChecker = new HttpChecker();

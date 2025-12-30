import {
  type MonitorTarget,
  type CheckResult,
  success,
  failure,
  fetchWithTimeout,
  validateHttpResponse,
  DEFAULT_HTTP_TIMEOUT,
  DEFAULT_SSL_EXPIRY_THRESHOLD_DAYS,
  createLogger,
} from '@flarewatch/shared';
import { checkSSLCertificate } from './ssl';

const log = createLogger('HTTP');

const USER_AGENT = 'FlareWatch-Proxy/1.0 (+https://github.com/saminnet/flarewatch)';

/**
 * Check an HTTP/HTTPS endpoint
 */
export async function checkHttp(target: MonitorTarget): Promise<CheckResult> {
  const startTime = performance.now();
  const timeout = target.timeout ?? DEFAULT_HTTP_TIMEOUT;

  try {
    // Build headers
    const headers = new Headers(target.headers as HeadersInit);
    if (!headers.has('user-agent')) {
      headers.set('user-agent', USER_AGENT);
    }

    // Make request
    const response = await fetchWithTimeout(target.target, {
      method: target.method || 'GET',
      headers,
      body: target.body,
      timeout,
    });

    const latency = Math.round(performance.now() - startTime);
    log.info('Response', { name: target.name, status: response.status, latency });

    // Validate response
    const validationError = await validateHttpResponse(target, response);

    // Try to consume/cancel the body
    try {
      await response.body?.cancel();
    } catch {
      // Ignore cancellation errors
    }

    if (validationError) {
      log.info('Validation failed', { name: target.name, error: validationError });
      return failure(validationError, latency);
    }

    // Check SSL certificate if enabled and target is HTTPS
    if (target.sslCheckEnabled && target.target.startsWith('https://')) {
      try {
        const sslInfo = await checkSSLCertificate(target.target, {
          daysBeforeExpiry: target.sslCheckDaysBeforeExpiry ?? DEFAULT_SSL_EXPIRY_THRESHOLD_DAYS,
          ignoreSelfSigned: target.sslIgnoreSelfSigned ?? false,
          timeout: Math.max(timeout - latency, 1000), // Use remaining time
        });

        log.info('SSL expiry', { name: target.name, daysUntilExpiry: sslInfo.daysUntilExpiry });

        // Check if certificate is expiring soon
        const threshold = target.sslCheckDaysBeforeExpiry ?? DEFAULT_SSL_EXPIRY_THRESHOLD_DAYS;
        if (sslInfo.daysUntilExpiry <= threshold) {
          return failure(
            `SSL certificate expires in ${sslInfo.daysUntilExpiry} days (threshold: ${threshold})`,
            latency,
          );
        }

        return success(latency, sslInfo);
      } catch (sslError) {
        // SSL check failed
        const errorMessage = sslError instanceof Error ? sslError.message : String(sslError);
        log.warn('SSL check failed', { name: target.name, error: errorMessage });
        return failure(`SSL check failed: ${errorMessage}`, latency);
      }
    }

    return success(latency);
  } catch (error) {
    const latency = Math.round(performance.now() - startTime);
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Handle timeout specifically
    if (errorMessage.includes('timeout') || errorMessage.includes('abort')) {
      log.info('Timeout', { name: target.name, latency });
      return failure(`Timeout after ${timeout}ms`, latency);
    }

    log.info('Error', { name: target.name, error: errorMessage });
    return failure(errorMessage, latency);
  }
}

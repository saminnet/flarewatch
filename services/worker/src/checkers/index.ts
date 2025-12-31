import {
  type MonitorTarget,
  type CheckResult,
  type CheckResultWithLocation,
  failure,
  fetchWithTimeout,
  DEFAULT_HTTP_TIMEOUT,
  getErrorMessage,
} from '@flarewatch/shared';
import { getEdgeLocation } from '../utils/location';
import { httpChecker } from './http';
import { tcpChecker } from './tcp';
import { globalPingChecker } from './globalping';

/**
 * Check a monitor target using the appropriate checker
 * Returns result with location information
 */
export async function checkMonitor(
  target: MonitorTarget,
  env?: { FLAREWATCH_PROXY_TOKEN?: string },
): Promise<CheckResultWithLocation> {
  // GlobalPing proxy
  if (target.checkProxy?.startsWith('globalping://')) {
    return globalPingChecker.check(target);
  }

  if (target.checkProxy?.startsWith('worker://')) {
    const location = await getEdgeLocation();
    return {
      location,
      result: failure('worker:// checkProxy is not supported'),
    };
  }

  // External proxy (custom endpoint)
  if (target.checkProxy) {
    try {
      const timeout = target.timeout ?? DEFAULT_HTTP_TIMEOUT;
      const response = await fetchWithTimeout(target.checkProxy, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(env?.FLAREWATCH_PROXY_TOKEN
            ? { Authorization: `Bearer ${env.FLAREWATCH_PROXY_TOKEN}` }
            : {}),
        },
        body: JSON.stringify(target),
        timeout,
      });

      if (!response.ok) {
        const body = await response.text();
        return {
          location: 'ERROR',
          result: failure(`Proxy HTTP ${response.status}: ${body.slice(0, 200)}`),
        };
      }

      const data = (await response.json()) as {
        location: string;
        result: CheckResult;
      };

      if (!data || typeof data.location !== 'string' || !data.result) {
        return {
          location: 'ERROR',
          result: failure('Proxy returned invalid response'),
        };
      }

      return { location: data.location, result: data.result };
    } catch (error) {
      return {
        location: 'ERROR',
        result: failure(`Proxy error: ${getErrorMessage(error)}`),
      };
    }
  }

  const location = await getEdgeLocation();

  // TCP ping
  if (target.method === 'TCP_PING') {
    const result = await tcpChecker.check(target);
    return { location, result };
  }

  // HTTP/HTTPS (default)
  const result = await httpChecker.check(target);
  return { location, result };
}

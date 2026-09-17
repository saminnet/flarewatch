import {
  type CheckResult,
  type CheckResultWithLocation,
  type MonitorTarget,
  DEFAULT_HTTP_TIMEOUT,
  failure,
  fetchWithTimeout,
  getErrorMessage,
} from '@flarewatch/shared';

type ProxyEnv = {
  FLAREWATCH_PROXY_TOKEN?: string;
};

function isCheckResult(value: unknown): value is CheckResult {
  if (typeof value !== 'object' || value === null) return false;
  if (!('ok' in value)) return false;

  if (value.ok === true) {
    return 'latency' in value && typeof value.latency === 'number';
  }

  if (value.ok === false) {
    return (
      'error' in value &&
      typeof value.error === 'string' &&
      (!('latency' in value) || typeof value.latency === 'number')
    );
  }

  return false;
}

function isProxyCheckResponse(value: unknown): value is CheckResultWithLocation {
  if (typeof value !== 'object' || value === null) return false;
  if (!('location' in value) || typeof value.location !== 'string') return false;
  if (!('result' in value) || !isCheckResult(value.result)) return false;
  return true;
}

export async function checkExternalProxy(
  target: MonitorTarget,
  env?: ProxyEnv,
): Promise<CheckResultWithLocation> {
  if (!target.checkProxy) {
    return {
      location: 'ERROR',
      result: failure('Proxy URL is not configured'),
    };
  }

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

    const data: unknown = await response.json();
    if (!isProxyCheckResponse(data)) {
      return {
        location: 'ERROR',
        result: failure('Proxy returned invalid response'),
      };
    }

    return data;
  } catch (error) {
    return {
      location: 'ERROR',
      result: failure(`Proxy error: ${getErrorMessage(error)}`),
    };
  }
}

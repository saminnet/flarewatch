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
  if (!value || typeof value !== 'object') return false;

  const result = value as Record<string, unknown>;
  if (result.ok === true) {
    return typeof result.latency === 'number';
  }

  if (result.ok === false) {
    return (
      typeof result.error === 'string' &&
      (result.latency === undefined || typeof result.latency === 'number')
    );
  }

  return false;
}

function isProxyCheckResponse(value: unknown): value is CheckResultWithLocation {
  if (!value || typeof value !== 'object') return false;

  const response = value as Record<string, unknown>;
  return typeof response.location === 'string' && isCheckResult(response.result);
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

    const data = (await response.json()) as unknown;
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

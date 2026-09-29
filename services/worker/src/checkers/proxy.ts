import {
  createLogger,
  type CheckResult,
  type CheckResultWithLocation,
  type MonitorTarget,
  DEFAULT_HTTP_TIMEOUT,
  failure,
  fetchWithTimeout,
  type Fetcher,
  getErrorMessage,
  isJsonObject,
  readJsonUpTo,
  readTextUpTo,
} from '@flarewatch/shared';

const log = createLogger('Proxy');

type ProxyEnv = {
  FLAREWATCH_PROXY_TOKEN?: string;
};

function isCheckResult(value: unknown): value is CheckResult {
  if (!isJsonObject(value)) return false;

  if (value.ok === true) {
    return typeof value.latency === 'number';
  }

  if (value.ok === false) {
    return (
      typeof value.error === 'string' &&
      (value.latency === undefined || typeof value.latency === 'number')
    );
  }

  return false;
}

function isProxyCheckResponse(value: unknown): value is CheckResultWithLocation {
  if (!isJsonObject(value)) return false;
  return typeof value.location === 'string' && isCheckResult(value.result);
}

export async function checkExternalProxy(
  target: MonitorTarget,
  env?: ProxyEnv,
  fetcher: Fetcher = fetchWithTimeout,
): Promise<CheckResultWithLocation> {
  if (!target.checkProxy) {
    return {
      location: 'ERROR',
      result: failure('Proxy URL is not configured'),
    };
  }

  try {
    const timeout = target.timeout ?? DEFAULT_HTTP_TIMEOUT;
    const response = await fetcher(target.checkProxy, {
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
      // The body goes to the owner's logs only: the error is public, and a proxy
      // can echo the token or the monitor config it was sent.
      const body = await readTextUpTo(response, 4096);
      const token = env?.FLAREWATCH_PROXY_TOKEN;
      log.warn('Proxy failed', {
        status: response.status,
        body: (token ? body.replaceAll(token, '<proxy token>') : body).slice(0, 200),
      });
      return { location: 'ERROR', result: failure(`Proxy HTTP ${response.status}`) };
    }

    const data = await readJsonUpTo(response, 1024 * 1024);
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

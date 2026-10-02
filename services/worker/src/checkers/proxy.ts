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
  MAX_BODY_BYTES,
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
  url: string,
  env?: ProxyEnv,
  fetcher: Fetcher = fetchWithTimeout,
): Promise<CheckResultWithLocation> {
  // The other place may be Globalping, and its URL holds a token the proxy has no use for.
  const { checkProxy: _checkProxy, confirmVia: _confirmVia, ...monitor } = target;
  try {
    const timeout = target.timeout ?? DEFAULT_HTTP_TIMEOUT;
    const response = await fetcher(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env?.FLAREWATCH_PROXY_TOKEN
          ? { Authorization: `Bearer ${env.FLAREWATCH_PROXY_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(monitor),
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

    const data = await readJsonUpTo(response, MAX_BODY_BYTES);
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

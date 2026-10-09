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

/** A latency that is not a finite, non-negative number would poison the hour's shared sample row. */
function isLatency(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isCheckResult(value: unknown): value is CheckResult {
  if (!isJsonObject(value)) return false;

  if (value.ok === true) {
    const ssl = value.ssl;
    return (
      value.warning === undefined &&
      isLatency(value.latency) &&
      (ssl === undefined ||
        (isJsonObject(ssl) &&
          typeof ssl.expiryDate === 'number' &&
          Number.isFinite(ssl.expiryDate) &&
          Math.abs(ssl.expiryDate) <= 8.64e12 &&
          typeof ssl.daysUntilExpiry === 'number' &&
          Number.isFinite(ssl.daysUntilExpiry)))
    );
  }

  if (value.ok === false) {
    return (
      typeof value.error === 'string' && (value.latency === undefined || isLatency(value.latency))
    );
  }

  return false;
}

type ProxyCheckResponse = CheckResultWithLocation & { contract?: unknown };

function isProxyCheckResponse(value: unknown): value is ProxyCheckResponse {
  if (!isJsonObject(value)) return false;
  return typeof value.location === 'string' && isCheckResult(value.result);
}

/** flarewatch-proxy before 2.0.0 drops these fields and passes the check without them. */
function runsAssertions(response: ProxyCheckResponse): boolean {
  const { contract } = response;
  return typeof contract === 'number' && Number.isInteger(contract) && contract >= 2;
}

export async function checkExternalProxy(
  target: MonitorTarget,
  url: string,
  env?: ProxyEnv,
  fetcher: Fetcher = fetchWithTimeout,
): Promise<CheckResultWithLocation> {
  // The other place may be Globalping, and its URL holds a token the proxy has no use for.
  const { checkProxy: _checkProxy, confirmVia: _confirmVia, ...monitor } = target;
  // A proxy can echo the token it was sent, and its location and errors are public.
  const token = env?.FLAREWATCH_PROXY_TOKEN;
  const redact = (text: string) => (token ? text.replaceAll(token, '<proxy token>') : text);
  try {
    const timeout = target.timeout ?? DEFAULT_HTTP_TIMEOUT;
    const response = await fetcher(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        ...monitor,
        ...(monitor.sslCheckEnabled && { sslCheckDaysBeforeExpiry: 0 }),
      }),
      timeout,
      redirect: 'error',
    });

    if (!response.ok) {
      // The body goes to the owner's logs only: the error is public, and a proxy
      // can echo the token or the monitor config it was sent.
      const body = await readTextUpTo(response, 4096);
      log.warn('Proxy failed', { status: response.status, body: redact(body).slice(0, 200) });
      return { location: 'ERROR', result: failure(`Proxy HTTP ${response.status}`) };
    }

    const data = await readJsonUpTo(response, MAX_BODY_BYTES);
    if (!isProxyCheckResponse(data)) {
      return {
        location: 'ERROR',
        result: failure('Proxy returned invalid response'),
      };
    }

    const asserts =
      monitor.responseHeaderEquals !== undefined || monitor.responseJsonPath !== undefined;
    if (asserts && !runsAssertions(data)) {
      return {
        location: 'ERROR',
        result: failure(
          'Proxy is too old for header and JSON checks: update to flarewatch-proxy 2.0.0',
        ),
      };
    }

    if (!data.result.ok) data.result.error = redact(data.result.error);
    return { location: redact(data.location), result: data.result };
  } catch (error) {
    return {
      location: 'ERROR',
      result: failure(`Proxy error: ${redact(getErrorMessage(error))}`),
    };
  }
}

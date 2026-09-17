import {
  type MonitorTarget,
  type CheckResultWithLocation,
  type SSLCertificateInfo,
  success,
  failure,
  fetchWithTimeout,
  validateHttpStatusAndBody,
  parseTcpTarget,
  DEFAULT_HTTP_TIMEOUT,
  DEFAULT_SSL_EXPIRY_THRESHOLD_DAYS,
  createLogger,
} from '@flarewatch/shared';
import { z } from 'zod';

const log = createLogger('GlobalPing');

const GLOBALPING_API = 'https://api.globalping.io/v1/measurements';
const API_TIMEOUT = 5000;
const POLL_INTERVAL = 1000;

interface GlobalPingConfig {
  token: string;
  magic?: string;
  ipVersion?: number;
}

const measurementResultSchema = z.object({
  status: z.string(),
  results: z.array(
    z.object({
      probe: z.object({ country: z.string(), city: z.string() }),
      result: z.object({
        status: z.string(),
        rawOutput: z.string().optional(),
        statusCode: z.number().optional(),
        rawBody: z.string().optional(),
        timings: z.object({ total: z.number() }).optional(),
        stats: z.object({ avg: z.number() }).optional(),
        tls: z
          .object({
            authorized: z.boolean(),
            error: z.string().optional(),
            certificate: z
              .object({
                expiresAt: z.string().optional(),
                issuer: z.object({ commonName: z.string().optional() }).optional(),
                subject: z.object({ commonName: z.string().optional() }).optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    }),
  ),
});

type MeasurementResult = z.infer<typeof measurementResultSchema>;

interface CertExpiryInfo {
  expiryDate: number;
  daysUntilExpiry: number;
}

interface HttpValidationResult {
  error: string | null;
  ssl?: SSLCertificateInfo;
}

function parseProxyUrl(proxyUrl: string): GlobalPingConfig {
  const url = new URL(proxyUrl);
  const magic = url.searchParams.get('magic');
  const config: GlobalPingConfig = {
    token: url.hostname,
    ipVersion: parseInt(url.searchParams.get('ipVersion') ?? '4', 10),
  };
  if (magic) {
    config.magic = magic;
  }
  return config;
}

function buildTcpRequest(target: MonitorTarget, config: GlobalPingConfig) {
  const { hostname, port } = parseTcpTarget(target.target);

  return {
    type: 'ping',
    target: hostname,
    locations: config.magic ? [{ magic: config.magic }] : undefined,
    measurementOptions: {
      port,
      packets: 1,
      protocol: target.pingProtocol ?? 'tcp',
      ipVersion: config.ipVersion,
    },
  };
}

function buildHttpRequest(target: MonitorTarget, config: GlobalPingConfig) {
  const targetUrl = new URL(target.target);

  if (target.body) {
    throw new Error('Custom body not supported with GlobalPing');
  }

  const method = target.method?.toUpperCase() ?? 'GET';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    throw new Error(`Method ${method} not supported with GlobalPing (only GET, HEAD, OPTIONS)`);
  }

  return {
    type: 'http',
    target: targetUrl.hostname,
    locations: config.magic ? [{ magic: config.magic }] : undefined,
    measurementOptions: {
      request: {
        method,
        path: targetUrl.pathname,
        query: targetUrl.search || undefined,
        headers: {
          Host: targetUrl.hostname,
          ...Object.fromEntries(
            Object.entries(target.headers ?? {}).map(([k, v]) => [k, String(v)]),
          ),
        },
      },
      port:
        targetUrl.port !== ''
          ? parseInt(targetUrl.port, 10)
          : targetUrl.protocol === 'http:'
            ? 80
            : 443,
      protocol: targetUrl.protocol.replace(':', ''),
      ipVersion: config.ipVersion,
    },
  };
}

function calculateCertExpiry(expiresAt: string): CertExpiryInfo {
  const expiryDate = Math.floor(new Date(expiresAt).getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);
  const daysUntilExpiry = Math.floor((expiryDate - now) / 86400);
  return { expiryDate, daysUntilExpiry };
}

function validateHttpResult(
  target: MonitorTarget,
  result: MeasurementResult['results'][0]['result'],
): HttpValidationResult {
  let ssl: SSLCertificateInfo | undefined;

  let error = validateHttpStatusAndBody(result.statusCode ?? 0, result.rawBody ?? '', {
    expectedCodes: target.expectedCodes,
    responseKeyword: target.responseKeyword,
    responseForbiddenKeyword: target.responseForbiddenKeyword,
  });

  const tls = result.tls;
  if (tls && target.target.toLowerCase().startsWith('https')) {
    if (!error && !tls.authorized && !target.sslIgnoreSelfSigned) {
      error = `TLS error: ${tls.error ?? 'Certificate not trusted'}`;
    }

    // Extract certificate info
    if (tls.certificate?.expiresAt) {
      const { expiryDate, daysUntilExpiry } = calculateCertExpiry(tls.certificate.expiresAt);
      ssl = { expiryDate, daysUntilExpiry };
      if (tls.certificate.issuer?.commonName) {
        ssl.issuer = tls.certificate.issuer.commonName;
      }
      if (tls.certificate.subject?.commonName) {
        ssl.subject = tls.certificate.subject.commonName;
      }

      // Check expiry threshold
      if (!error && target.sslCheckEnabled) {
        const threshold = target.sslCheckDaysBeforeExpiry ?? DEFAULT_SSL_EXPIRY_THRESHOLD_DAYS;
        if (daysUntilExpiry <= threshold) {
          error = `Certificate expires in ${daysUntilExpiry} days (threshold: ${threshold})`;
        }
      }
    }
  }

  if (ssl) {
    return { error, ssl };
  }
  return { error };
}

async function createMeasurement(
  request: ReturnType<typeof buildHttpRequest> | ReturnType<typeof buildTcpRequest>,
  token: string,
): Promise<string> {
  const response = await fetchWithTimeout(GLOBALPING_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(request),
    timeout: API_TIMEOUT,
  });

  if (response.status !== 202) {
    const errorBody = z
      .object({ error: z.object({ message: z.string() }).optional() })
      .safeParse(await response.json());
    throw new Error(
      (errorBody.success ? errorBody.data.error?.message : undefined) ??
        `API error: ${response.status}`,
    );
  }

  const created = z.object({ id: z.string() }).safeParse(await response.json());
  if (!created.success) {
    throw new Error('GlobalPing: invalid measurement creation response');
  }
  return created.data.id;
}

async function pollMeasurement(
  measurementId: string,
  timeoutMs: number,
): Promise<MeasurementResult> {
  const pollStart = Date.now();

  while (true) {
    if (Date.now() - pollStart > timeoutMs) {
      throw new Error('GlobalPing measurement timeout');
    }

    const response = await fetchWithTimeout(`${GLOBALPING_API}/${measurementId}`, {
      timeout: API_TIMEOUT,
    });
    const parsed = measurementResultSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error('GlobalPing: invalid measurement payload');
    }
    const result = parsed.data;

    if (result.status !== 'in-progress') {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

function parseMeasurementResult(
  target: MonitorTarget,
  measurement: MeasurementResult,
): CheckResultWithLocation {
  const probeResult = measurement.results[0];
  if (!probeResult) {
    throw new Error('No probe result returned');
  }

  if (measurement.status !== 'finished' || probeResult.result.status !== 'finished') {
    throw new Error(
      `Measurement failed: ${probeResult.result.rawOutput?.slice(0, 100) ?? 'Unknown error'}`,
    );
  }

  const location = `${probeResult.probe.country}/${probeResult.probe.city}`;

  if (target.method === 'TCP_PING') {
    const latency = Math.round(probeResult.result.stats?.avg ?? 0);
    log.info('TCP ping', { name: target.name, latency, location });
    return { location, result: success(latency) };
  }

  const latency = Math.round(probeResult.result.timings?.total ?? 0);
  const { error, ssl } = validateHttpResult(target, probeResult.result);

  if (error) {
    log.info('Check failed', { name: target.name, error, location });
    return { location, result: failure(error, latency) };
  }

  log.info('OK', { name: target.name, latency, location });
  return { location, result: success(latency, ssl) };
}

/**
 * GlobalPing checker for geo-distributed monitoring
 */
export class GlobalPingChecker {
  async check(target: MonitorTarget): Promise<CheckResultWithLocation> {
    if (!target.checkProxy?.startsWith('globalping://')) {
      throw new Error('Invalid GlobalPing proxy URL');
    }

    try {
      const config = parseProxyUrl(target.checkProxy);

      const measurementRequest =
        target.method === 'TCP_PING'
          ? buildTcpRequest(target, config)
          : buildHttpRequest(target, config);

      log.info('Creating measurement', { name: target.name });
      const measurementId = await createMeasurement(measurementRequest, config.token);
      const pollTimeout = (target.timeout ?? DEFAULT_HTTP_TIMEOUT) + 2000;
      const measurement = await pollMeasurement(measurementId, pollTimeout);
      return parseMeasurementResult(target, measurement);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTimeout = errorMessage.toLowerCase().includes('timeout');

      log.error('Error', { name: target.name, error: errorMessage });

      return {
        location: 'ERROR',
        result: failure(`GlobalPing: ${errorMessage}`, isTimeout ? target.timeout : undefined),
      };
    }
  }
}

export const globalPingChecker = new GlobalPingChecker();

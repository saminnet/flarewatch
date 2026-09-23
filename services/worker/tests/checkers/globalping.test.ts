import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Fetcher, JsonValue, MonitorTarget } from '@flarewatch/shared';
import { GlobalPingChecker } from '../../src/checkers/globalping';

const fetchMock = vi.fn<Fetcher>();
const checker = new GlobalPingChecker(fetchMock);

function createMonitor(overrides: Partial<MonitorTarget> = {}): MonitorTarget {
  return {
    id: 'test-monitor',
    name: 'Test Monitor',
    method: 'GET',
    target: 'https://example.com',
    checkProxy: 'globalping://test-token',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function finishedHttpMeasurement(resultOverrides: Record<string, JsonValue> = {}): JsonValue {
  return {
    status: 'finished',
    results: [
      {
        probe: { country: 'FI', city: 'Helsinki' },
        result: {
          status: 'finished',
          statusCode: 200,
          rawBody: 'ok',
          timings: { total: 12.6 },
          ...resultOverrides,
        },
      },
    ],
  };
}

function mockCompletedMeasurement(measurement: JsonValue): void {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ id: 'measurement-1' }, 202))
    .mockResolvedValueOnce(jsonResponse(measurement));
}

describe('GlobalPingChecker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses proxy settings and builds an HTTP measurement request', async () => {
    mockCompletedMeasurement(finishedHttpMeasurement());

    const result = await checker.check(
      createMonitor({
        method: 'OPTIONS',
        target: 'https://example.com:8443/health?ready=1',
        headers: { 'X-Region': 'eu', 'X-Retry': 2 },
        checkProxy: 'globalping://CaseSensitiveToken?magic=aws-us-east-1&ipVersion=6',
      }),
    );

    expect(result).toEqual({ location: 'FI/Helsinki', result: { ok: true, latency: 13 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.globalping.io/v1/measurements');
    const { body, ...request } = options ?? {};
    expect(request).toEqual({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer CaseSensitiveToken',
      },
      timeout: 5000,
    });
    expect(typeof body).toBe('string');
    expect(JSON.parse(body as string)).toEqual({
      type: 'http',
      target: 'example.com',
      locations: [{ magic: 'aws-us-east-1' }],
      measurementOptions: {
        request: {
          method: 'OPTIONS',
          path: '/health',
          query: '?ready=1',
          headers: {
            Host: 'example.com',
            'X-Region': 'eu',
            'X-Retry': '2',
          },
        },
        port: 8443,
        protocol: 'https',
        ipVersion: 6,
      },
    });
  });

  it('builds a TCP_PING measurement request', async () => {
    mockCompletedMeasurement({
      status: 'finished',
      results: [
        {
          probe: { country: 'DE', city: 'Frankfurt' },
          result: { status: 'finished', stats: { avg: 8.7 } },
        },
      ],
    });

    const result = await checker.check(
      createMonitor({
        method: 'TCP_PING',
        target: 'example.com:8443',
        checkProxy: 'globalping://tcp-token?magic=eyeball-network&ipVersion=6',
      }),
    );

    expect(result).toEqual({ location: 'DE/Frankfurt', result: { ok: true, latency: 9 } });

    const [, options] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(options?.body as string)).toEqual({
      type: 'ping',
      target: 'example.com',
      locations: [{ magic: 'eyeball-network' }],
      measurementOptions: {
        port: 8443,
        packets: 1,
        protocol: 'tcp',
        ipVersion: 6,
      },
    });
  });

  it('accepts a TCP_PING target on port 443', async () => {
    mockCompletedMeasurement({
      status: 'finished',
      results: [
        {
          probe: { country: 'NL', city: 'Amsterdam' },
          result: { status: 'finished', stats: { avg: 4.2 } },
        },
      ],
    });

    const result = await checker.check(
      createMonitor({
        method: 'TCP_PING',
        target: 'example.com:443',
        checkProxy: 'globalping://tcp-token',
      }),
    );

    expect(result).toEqual({ location: 'NL/Amsterdam', result: { ok: true, latency: 4 } });

    const [, options] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(options?.body as string)).toMatchObject({
      measurementOptions: { port: 443 },
    });
  });

  it('returns an error for an unsupported HTTP method', async () => {
    const result = await checker.check(createMonitor({ method: 'POST' }));

    expect(result).toEqual({
      location: 'ERROR',
      result: {
        ok: false,
        error: 'GlobalPing: Method POST not supported with GlobalPing (only GET, HEAD, OPTIONS)',
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an error when an HTTP monitor has a body', async () => {
    const result = await checker.check(createMonitor({ body: '{"hello":"world"}' }));

    expect(result).toEqual({
      location: 'ERROR',
      result: { ok: false, error: 'GlobalPing: Custom body not supported with GlobalPing' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('polls until the measurement is no longer in progress', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'measurement-1' }, 202))
      .mockResolvedValueOnce(jsonResponse({ status: 'in-progress', results: [] }))
      .mockResolvedValueOnce(jsonResponse(finishedHttpMeasurement()));

    const resultPromise = checker.check(createMonitor());
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    expect(result).toEqual({ location: 'FI/Helsinki', result: { ok: true, latency: 13 } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.globalping.io/v1/measurements/measurement-1',
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'https://api.globalping.io/v1/measurements/measurement-1',
    );
  });

  it('returns a timeout error when polling exceeds the monitor timeout', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'measurement-1' }, 202))
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ status: 'in-progress', results: [] })),
      );

    const resultPromise = checker.check(createMonitor({ timeout: 500 }));
    await vi.advanceTimersByTimeAsync(3000);
    const result = await resultPromise;

    expect(result).toEqual({
      location: 'ERROR',
      result: {
        ok: false,
        error: 'GlobalPing: GlobalPing measurement timeout',
        latency: 500,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('returns parsed TLS certificate information', async () => {
    mockCompletedMeasurement(
      finishedHttpMeasurement({
        tls: {
          authorized: true,
          certificate: {
            expiresAt: '2025-02-20T12:00:00Z',
            issuer: { commonName: 'Example CA' },
            subject: { commonName: 'example.com' },
          },
        },
      }),
    );

    const result = await checker.check(createMonitor());

    expect(result).toEqual({
      location: 'FI/Helsinki',
      result: {
        ok: true,
        latency: 13,
        ssl: {
          expiryDate: 1740052800,
          daysUntilExpiry: 36,
          issuer: 'Example CA',
          subject: 'example.com',
        },
      },
    });
  });

  it('fails when certificate expiry reaches the configured threshold', async () => {
    mockCompletedMeasurement(
      finishedHttpMeasurement({
        tls: {
          authorized: true,
          certificate: { expiresAt: '2025-01-29T12:00:00Z' },
        },
      }),
    );

    const result = await checker.check(
      createMonitor({ sslCheckEnabled: true, sslCheckDaysBeforeExpiry: 14 }),
    );

    expect(result).toEqual({
      location: 'FI/Helsinki',
      result: {
        ok: false,
        error: 'Certificate expires in 14 days (threshold: 14)',
        latency: 13,
      },
    });
  });

  it('ignores an unauthorized self-signed certificate when configured', async () => {
    mockCompletedMeasurement(
      finishedHttpMeasurement({
        tls: { authorized: false, error: 'self signed certificate' },
      }),
    );

    const result = await checker.check(createMonitor({ sslIgnoreSelfSigned: true }));

    expect(result).toEqual({ location: 'FI/Helsinki', result: { ok: true, latency: 13 } });
  });

  it('returns location ERROR when an unexpected request failure is caught', async () => {
    fetchMock.mockRejectedValue(new Error('service unavailable'));

    const result = await checker.check(createMonitor());

    expect(result).toEqual({
      location: 'ERROR',
      result: { ok: false, error: 'GlobalPing: service unavailable' },
    });
  });
  it('fails the check when the measurement payload does not match the schema', async () => {
    // A probe entry missing `city` must fail schema validation, not render an undefined city.
    mockCompletedMeasurement({
      status: 'finished',
      results: [{ probe: { country: 'FI' }, result: { status: 'finished', statusCode: 200 } }],
    });

    const result = await checker.check(createMonitor());

    expect(result).toEqual({
      location: 'ERROR',
      result: { ok: false, error: 'GlobalPing: invalid measurement payload' },
    });
  });

  it('fails the check when measurement creation returns no id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ notAnId: true }, 202));

    const result = await checker.check(createMonitor());

    expect(result).toEqual({
      location: 'ERROR',
      result: {
        ok: false,
        error: 'GlobalPing: invalid measurement creation response',
      },
    });
  });

  it('uses the API error message when creation is rejected with an error payload', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: 'Invalid token' } }, 401));

    const result = await checker.check(createMonitor());

    expect(result).toEqual({
      location: 'ERROR',
      result: { ok: false, error: 'GlobalPing: Invalid token' },
    });
  });

  it('falls back to the status code when the error payload is malformed', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('nope', 429));

    const result = await checker.check(createMonitor());

    expect(result).toEqual({
      location: 'ERROR',
      result: { ok: false, error: 'GlobalPing: API error: 429' },
    });
  });
});

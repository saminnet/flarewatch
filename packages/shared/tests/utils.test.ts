import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchWithTimeout,
  TimeoutError,
  withTimeout,
  validateHttpResponse,
  parseTcpTarget,
  success,
  failure,
} from '../src/utils';
import type { MonitorTarget, SSLCertificateInfo } from '../src/types';

describe('TimeoutError', () => {
  it('creates error with correct message', () => {
    const error = new TimeoutError(5000);

    expect(error.message).toBe('Operation timed out after 5000ms');
    expect(error.name).toBe('TimeoutError');
  });

  it('is instanceof Error', () => {
    const error = new TimeoutError(1000);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(TimeoutError);
  });

  it('handles different timeout values', () => {
    expect(new TimeoutError(0).message).toBe('Operation timed out after 0ms');
    expect(new TimeoutError(100).message).toBe('Operation timed out after 100ms');
    expect(new TimeoutError(60000).message).toBe('Operation timed out after 60000ms');
  });
});

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when promise completes before timeout', async () => {
    const promise = Promise.resolve('success');

    const result = await withTimeout(promise, 1000);

    expect(result).toBe('success');
  });

  it('rejects with TimeoutError when promise takes too long', async () => {
    const slowPromise = new Promise((resolve) => {
      setTimeout(() => resolve('too late'), 2000);
    });

    const resultPromise = withTimeout(slowPromise, 1000);
    vi.advanceTimersByTime(1000);

    await expect(resultPromise).rejects.toThrow(TimeoutError);
    await expect(resultPromise).rejects.toThrow('Operation timed out after 1000ms');
  });

  it('passes through original error when promise rejects', async () => {
    const errorPromise = Promise.reject(new Error('original error'));

    await expect(withTimeout(errorPromise, 1000)).rejects.toThrow('original error');
  });

  it('clears timeout when promise resolves', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const promise = Promise.resolve('done');

    await withTimeout(promise, 5000);

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('clears timeout when promise rejects', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const promise = Promise.reject(new Error('fail'));

    await expect(withTimeout(promise, 5000)).rejects.toThrow('fail');

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('works with async values', async () => {
    const asyncValue = (async () => {
      return { data: 'test' };
    })();

    const result = await withTimeout(asyncValue, 1000);

    expect(result).toEqual({ data: 'test' });
  });
});

describe('fetchWithTimeout', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('calls fetch with provided URL and options', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = mockFetch;

    const responsePromise = fetchWithTimeout('https://example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    await vi.runAllTimersAsync();
    await responsePromise;

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('uses default timeout of 10000ms', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = mockFetch;

    const responsePromise = fetchWithTimeout('https://example.com');

    await vi.runAllTimersAsync();
    await responsePromise;

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(options.signal).toBeDefined();
  });

  it('passes body when provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = mockFetch;

    const responsePromise = fetchWithTimeout('https://example.com', {
      method: 'POST',
      body: JSON.stringify({ test: true }),
    });

    await vi.runAllTimersAsync();
    await responsePromise;

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(options.body).toBe('{"test":true}');
  });

  it('returns response on success', async () => {
    const mockResponse = new Response('test body', { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const responsePromise = fetchWithTimeout('https://example.com');
    await vi.runAllTimersAsync();
    const response = await responsePromise;

    expect(response).toBe(mockResponse);
    expect(response.status).toBe(200);
  });

  it('propagates fetch errors', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const responsePromise = fetchWithTimeout('https://example.com');
    vi.runAllTimers();

    await expect(responsePromise).rejects.toThrow('Network error');
  });
});

describe('validateHttpResponse', () => {
  function createMonitor(overrides: Partial<MonitorTarget> = {}): MonitorTarget {
    return {
      id: 'test',
      name: 'Test Monitor',
      method: 'GET',
      target: 'https://example.com',
      ...overrides,
    };
  }

  describe('status code validation', () => {
    it('accepts 2xx status codes by default', async () => {
      const monitor = createMonitor();

      // Note: Response constructor requires status 200-599 and 204/304 must have null body
      for (const status of [200, 201, 299]) {
        const response = new Response('ok', { status });
        const result = await validateHttpResponse(monitor, response);
        expect(result).toBeNull();
      }

      // 204 No Content must have null body
      const response204 = new Response(null, { status: 204 });
      expect(await validateHttpResponse(monitor, response204)).toBeNull();
    });

    it('rejects non-2xx status codes by default', async () => {
      const monitor = createMonitor();

      const response = new Response('error', { status: 404 });
      const result = await validateHttpResponse(monitor, response);

      expect(result).toBe('Expected 2xx status, got 404');
    });

    it('rejects 3xx status codes by default', async () => {
      const monitor = createMonitor();
      const response = new Response('', { status: 301 });

      const result = await validateHttpResponse(monitor, response);

      expect(result).toBe('Expected 2xx status, got 301');
    });

    it('rejects 5xx status codes by default', async () => {
      const monitor = createMonitor();
      const response = new Response('error', { status: 500 });

      const result = await validateHttpResponse(monitor, response);

      expect(result).toBe('Expected 2xx status, got 500');
    });

    it('accepts custom expectedCodes', async () => {
      const monitor = createMonitor({ expectedCodes: [200, 201, 404] });

      const response404 = new Response('not found', { status: 404 });
      expect(await validateHttpResponse(monitor, response404)).toBeNull();

      const response200 = new Response('ok', { status: 200 });
      expect(await validateHttpResponse(monitor, response200)).toBeNull();
    });

    it('rejects status not in expectedCodes', async () => {
      const monitor = createMonitor({ expectedCodes: [200, 201] });

      const response = new Response('error', { status: 500 });
      const result = await validateHttpResponse(monitor, response);

      expect(result).toBe('Expected status 200|201, got 500');
    });

    it('formats single expectedCode correctly', async () => {
      const monitor = createMonitor({ expectedCodes: [204] });

      const response = new Response('error', { status: 200 });
      const result = await validateHttpResponse(monitor, response);

      expect(result).toBe('Expected status 204, got 200');
    });
  });

  describe('keyword validation', () => {
    it('passes when responseKeyword is found', async () => {
      const monitor = createMonitor({ responseKeyword: 'success' });
      const response = new Response('Operation success completed', { status: 200 });

      const result = await validateHttpResponse(monitor, response);

      expect(result).toBeNull();
    });

    it('fails when responseKeyword is not found', async () => {
      const monitor = createMonitor({ responseKeyword: 'success' });
      const response = new Response('Operation failed', { status: 200 });

      const result = await validateHttpResponse(monitor, response);

      expect(result).toBe('Required keyword "success" not found in response');
    });

    it('fails when responseForbiddenKeyword is found', async () => {
      const monitor = createMonitor({ responseForbiddenKeyword: 'error' });
      const response = new Response('An error occurred', { status: 200 });

      const result = await validateHttpResponse(monitor, response);

      expect(result).toBe('Forbidden keyword "error" found in response');
    });

    it('passes when responseForbiddenKeyword is not found', async () => {
      const monitor = createMonitor({ responseForbiddenKeyword: 'error' });
      const response = new Response('All good', { status: 200 });

      const result = await validateHttpResponse(monitor, response);

      expect(result).toBeNull();
    });

    it('checks both keywords when configured', async () => {
      const monitor = createMonitor({
        responseKeyword: 'ok',
        responseForbiddenKeyword: 'error',
      });

      // Has required, no forbidden - passes
      const goodResponse = new Response('status: ok', { status: 200 });
      expect(await validateHttpResponse(monitor, goodResponse)).toBeNull();

      // Missing required - fails
      const missingRequired = new Response('status: done', { status: 200 });
      expect(await validateHttpResponse(monitor, missingRequired)).toBe(
        'Required keyword "ok" not found in response',
      );

      // Has forbidden - fails (checked after required)
      const hasForbidden = new Response('ok but error', { status: 200 });
      expect(await validateHttpResponse(monitor, hasForbidden)).toBe(
        'Forbidden keyword "error" found in response',
      );
    });

    it('keyword matching is case-sensitive', async () => {
      const monitor = createMonitor({ responseKeyword: 'SUCCESS' });
      const response = new Response('success', { status: 200 });

      const result = await validateHttpResponse(monitor, response);

      expect(result).toBe('Required keyword "SUCCESS" not found in response');
    });

    it('skips body check when no keywords configured', async () => {
      const monitor = createMonitor();
      const response = new Response('anything', { status: 200 });

      const result = await validateHttpResponse(monitor, response);

      expect(result).toBeNull();
    });
  });

  describe('combined validation', () => {
    it('checks status before keywords', async () => {
      const monitor = createMonitor({ responseKeyword: 'ok' });
      const response = new Response('ok', { status: 500 });

      const result = await validateHttpResponse(monitor, response);

      // Status check fails first
      expect(result).toBe('Expected 2xx status, got 500');
    });
  });
});

describe('parseTcpTarget', () => {
  describe('valid targets', () => {
    it('parses hostname:port format', () => {
      const result = parseTcpTarget('example.com:80');

      expect(result).toEqual({ hostname: 'example.com', port: 80 });
    });

    it('parses IP address with port', () => {
      const result = parseTcpTarget('192.168.1.1:443');

      expect(result).toEqual({ hostname: '192.168.1.1', port: 443 });
    });

    it('parses localhost with port', () => {
      const result = parseTcpTarget('localhost:3000');

      expect(result).toEqual({ hostname: 'localhost', port: 3000 });
    });

    it('handles port boundaries', () => {
      expect(parseTcpTarget('host:1')).toEqual({ hostname: 'host', port: 1 });
      expect(parseTcpTarget('host:65535')).toEqual({ hostname: 'host', port: 65535 });
    });

    it('handles subdomains', () => {
      const result = parseTcpTarget('api.v2.example.com:8080');

      expect(result).toEqual({ hostname: 'api.v2.example.com', port: 8080 });
    });
  });

  describe('invalid targets', () => {
    it('throws on missing port', () => {
      expect(() => parseTcpTarget('example.com')).toThrow(
        'TCP target must include a port (hostname:port)',
      );
    });

    it('throws on empty string', () => {
      expect(() => parseTcpTarget('')).toThrow('Invalid TCP target hostname');
    });

    it('throws on port 0', () => {
      expect(() => parseTcpTarget('host:0')).toThrow('Invalid TCP port: 0');
    });

    it('throws on negative port', () => {
      expect(() => parseTcpTarget('host:-1')).toThrow('Invalid URL');
    });

    it('throws on port > 65535', () => {
      expect(() => parseTcpTarget('host:65536')).toThrow('Invalid URL');
    });

    it('throws on non-numeric port', () => {
      expect(() => parseTcpTarget('host:abc')).toThrow('Invalid URL');
    });

    it('throws on floating point port', () => {
      expect(() => parseTcpTarget('host:80.5')).toThrow('Invalid URL');
    });

    it('throws on missing hostname', () => {
      expect(() => parseTcpTarget(':80')).toThrow('Invalid URL');
    });
  });
});

describe('success', () => {
  it('creates a success result with latency only', () => {
    const result = success(42);

    expect(result).toEqual({ ok: true, latency: 42 });
  });

  it('creates a success result with SSL info', () => {
    const ssl: SSLCertificateInfo = {
      expiryDate: 1735689600,
      daysUntilExpiry: 30,
      issuer: "Let's Encrypt",
      subject: 'example.com',
    };

    const result = success(100, ssl);

    expect(result).toEqual({ ok: true, latency: 100, ssl });
  });

  it('handles zero latency', () => {
    const result = success(0);

    expect(result.latency).toBe(0);
    expect(result.ok).toBe(true);
  });
});

describe('failure', () => {
  it('creates a failure result with error only', () => {
    const result = failure('Connection refused');

    expect(result).toEqual({ ok: false, error: 'Connection refused' });
  });

  it('creates a failure result with error and latency', () => {
    const result = failure('Timeout', 5000);

    expect(result).toEqual({ ok: false, error: 'Timeout', latency: 5000 });
  });

  it('handles zero latency in failure', () => {
    const result = failure('Immediate failure', 0);

    expect(result.latency).toBe(0);
    expect(result.ok).toBe(false);
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createProxy } from '../src/app';
import type { CheckResultWithLocation } from '../src/types';

const fetchMock = vi.fn();

beforeAll(() => {
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes('httpstat.us/500')) {
      return Promise.resolve(new Response('fail', { status: 500 }));
    }

    return Promise.resolve(new Response('ok', { status: 200 }));
  });

  vi.stubGlobal('fetch', fetchMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('integration', () => {
  const app = createProxy({ authToken: 'test-token', location: 'TEST' });

  describe('API contract', () => {
    it('health endpoint returns expected shape', async () => {
      const res = await app.request('/health');
      const json = (await res.json()) as { status: string; timestamp: number };

      expect(res.status).toBe(200);
      expect(json).toHaveProperty('status');
      expect(json).toHaveProperty('timestamp');
      expect(typeof json.status).toBe('string');
      expect(typeof json.timestamp).toBe('number');
    });

    it('info endpoint returns expected shape', async () => {
      const res = await app.request('/');
      const json = (await res.json()) as {
        name: string;
        version: string;
        endpoints: Record<string, string>;
        docs: string;
      };

      expect(res.status).toBe(200);
      expect(json).toHaveProperty('name');
      expect(json).toHaveProperty('version');
      expect(json).toHaveProperty('endpoints');
      expect(json).toHaveProperty('docs');
    });

    it('check endpoint error response has expected shape', async () => {
      const res = await app.request('/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({}),
      });

      const json = (await res.json()) as { error: string };

      expect(res.status).toBe(400);
      expect(json).toHaveProperty('error');
      expect(typeof json.error).toBe('string');
    });

    it('unauthorized response has expected shape', async () => {
      const res = await app.request('/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'https://example.com' }),
      });

      const json = (await res.json()) as { error: string };

      expect(res.status).toBe(401);
      expect(json).toHaveProperty('error');
      expect(json.error).toBe('Unauthorized');
    });
  });

  describe('CheckResultWithLocation contract', () => {
    it('successful check returns CheckResultWithLocation shape', async () => {
      const res = await app.request('/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          id: 'integration-test',
          name: 'Integration Test',
          method: 'GET',
          target: 'https://httpstat.us/200',
          timeout: 10000,
        }),
      });

      expect(res.status).toBe(200);

      const json = (await res.json()) as CheckResultWithLocation;

      expect(json).toHaveProperty('location');
      expect(json).toHaveProperty('result');
      expect(typeof json.location).toBe('string');
      expect(json.result).toHaveProperty('ok');
      expect(typeof json.result.ok).toBe('boolean');

      const result = json.result;
      if (!result.ok) {
        throw new Error(`Expected success result, got error: ${result.error}`);
      }

      expect(result).toHaveProperty('latency');
      expect(typeof result.latency).toBe('number');
    });

    it('failed check returns CheckResultWithLocation shape with error', async () => {
      const res = await app.request('/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          id: 'integration-test-fail',
          name: 'Integration Test Fail',
          method: 'GET',
          target: 'https://httpstat.us/500',
          timeout: 10000,
        }),
      });

      expect(res.status).toBe(200);

      const json = (await res.json()) as CheckResultWithLocation;

      expect(json).toHaveProperty('location');
      expect(json).toHaveProperty('result');
      const result = json.result;
      if (result.ok) {
        throw new Error('Expected failed result');
      }

      expect(result.ok).toBe(false);
      expect(result).toHaveProperty('error');
    });
  });
});

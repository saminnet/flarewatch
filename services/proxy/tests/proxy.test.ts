import { describe, it, expect, vi } from 'vitest';
import { createProxy } from '../src/index';

vi.mock('../src/checkers', () => ({
  checkMonitor: vi.fn().mockResolvedValue({
    ok: true,
    latency: 100,
  }),
}));

vi.mock('../src/utils/location', () => ({
  getLocation: vi.fn().mockResolvedValue('TEST'),
  setLocation: vi.fn(),
}));

describe('proxy', () => {
  describe('without auth', () => {
    const app = createProxy({ location: 'TEST' });

    it('GET /health returns ok status', async () => {
      const res = await app.request('/health');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.status).toBe('ok');
      expect(json.timestamp).toBeTypeOf('number');
    });

    it('GET / returns info with endpoints', async () => {
      const res = await app.request('/');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.name).toBe('FlareWatch Proxy');
      expect(json.endpoints).toBeDefined();
      expect(json.docs).toContain('github.com');
    });

    it('POST /check returns 400 when target is missing', async () => {
      const res = await app.request('/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'test' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('target');
    });

    it('POST /check returns 400 when body is invalid JSON', async () => {
      const res = await app.request('/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Invalid JSON');
    });

    it('POST /check returns 400 when target is not a string', async () => {
      const res = await app.request('/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test',
          name: 'Test',
          method: 'GET',
          target: 123,
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('target');
    });

    it('POST /check returns 200 with valid monitor', async () => {
      const res = await app.request('/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test',
          name: 'Test',
          method: 'GET',
          target: 'https://example.com',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.location).toBe('TEST');
      expect(json.result).toBeDefined();
      expect(json.result.ok).toBe(true);
    });
  });

  describe('with auth', () => {
    const app = createProxy({ authToken: 'test-token', location: 'TEST' });

    it('POST /check returns 401 without auth header', async () => {
      const res = await app.request('/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test',
          name: 'Test',
          method: 'GET',
          target: 'https://example.com',
        }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Unauthorized');
    });

    it('POST /check returns 401 with wrong auth', async () => {
      const res = await app.request('/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer wrong-token',
        },
        body: JSON.stringify({
          id: 'test',
          name: 'Test',
          method: 'GET',
          target: 'https://example.com',
        }),
      });

      expect(res.status).toBe(401);
    });

    it('POST /check returns 200 with correct auth', async () => {
      const res = await app.request('/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({
          id: 'test',
          name: 'Test',
          method: 'GET',
          target: 'https://example.com',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.result.ok).toBe(true);
    });
  });
});

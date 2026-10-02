import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { fetchHubView, fetchPingUrl, forwardPing, triggerCheckRun } from '@/lib/monitor-worker';

function stubEnv() {
  const fetch = vi.fn(
    async (_input: Request | string, _init?: RequestInit) => new Response('OK', { status: 200 }),
  );
  vi.stubGlobal('__env__', { MONITOR_WORKER: { fetch } });
  return { fetch };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reading the hub', () => {
  it('fails without the MONITOR_WORKER binding', async () => {
    vi.stubGlobal('__env__', {});

    await expect(fetchHubView()).rejects.toThrow('MONITOR_WORKER binding not found');
  });
});

describe('triggerCheckRun', () => {
  it('asks the worker for a check run', async () => {
    const { fetch } = stubEnv();
    fetch.mockResolvedValueOnce(new Response(null, { status: 202 }));

    await expect(triggerCheckRun()).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith('https://internal/trigger', { method: 'POST' });
  });

  it('answers false without the binding, a refusal or a failed call', async () => {
    vi.stubGlobal('__env__', {});
    await expect(triggerCheckRun()).resolves.toBe(false);

    const { fetch } = stubEnv();
    fetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(triggerCheckRun()).resolves.toBe(false);

    fetch.mockRejectedValueOnce(new Error('binding down'));
    await expect(triggerCheckRun()).resolves.toBe(false);
  });
});

const ORIGIN = 'https://status.test';

describe('fetchPingUrl', () => {
  it('returns the ping URL built by the monitoring worker', async () => {
    const { fetch } = stubEnv();
    fetch.mockResolvedValueOnce(Response.json({ url: 'https://status.test/ping/backup/t0k3n' }));

    const url = await fetchPingUrl(ORIGIN, 'backup');

    expect(url).toBe('https://status.test/ping/backup/t0k3n');
    expect(fetch).toHaveBeenCalledWith('https://status.test/ping-url/backup');
  });

  it('returns null when the monitoring worker is not bound', async () => {
    vi.stubGlobal('__env__', {});

    await expect(fetchPingUrl(ORIGIN, 'backup')).resolves.toBeNull();
  });

  it('returns null when the monitoring worker rejects the id', async () => {
    stubEnv().fetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    await expect(fetchPingUrl(ORIGIN, 'ghost')).resolves.toBeNull();
  });
});

describe('forwardPing', () => {
  it('forwards method, path, and body verbatim and strips headers', async () => {
    const { fetch } = stubEnv();
    fetch.mockResolvedValueOnce(
      new Response('OK', {
        status: 200,
        headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      }),
    );
    const request = new Request('https://status.test/ping/backup/t0k3n/fail?query=1', {
      method: 'POST',
      body: 'nope',
      headers: { Cookie: 'flarewatch_admin_session=abc', Authorization: 'Basic xyz' },
    });

    const response = await forwardPing(request);

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    const forwarded = fetch.mock.calls[0]?.[0] as Request;
    expect(forwarded).toBeInstanceOf(Request);
    expect(forwarded.method).toBe('POST');
    expect(new URL(forwarded.url).pathname).toBe('/ping/backup/t0k3n/fail');
    expect(new URL(forwarded.url).search).toBe('?query=1');
    await expect(forwarded.text()).resolves.toBe('nope');
    expect(forwarded.headers.get('Cookie')).toBeNull();
    expect(forwarded.headers.get('Authorization')).toBeNull();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers 404 without the MONITOR_WORKER binding', async () => {
    vi.stubGlobal('__env__', {});

    const response = await forwardPing(new Request('https://status.test/ping/backup/t0k3n'));

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('answers 404 when the binding fetch fails', async () => {
    stubEnv().fetch.mockRejectedValueOnce(new Error('binding down'));

    const response = await forwardPing(
      new Request('https://status.test/ping/backup/t0k3n', { method: 'POST', body: 'x' }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

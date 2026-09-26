import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { forwardPing } from '@/lib/ping';

function stubEnv() {
  const fetch = vi.fn(async (_request: Request) => new Response('OK', { status: 200 }));
  vi.stubGlobal('__env__', { MONITOR_WORKER: { fetch } });
  return { fetch };
}

afterEach(() => {
  vi.unstubAllGlobals();
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

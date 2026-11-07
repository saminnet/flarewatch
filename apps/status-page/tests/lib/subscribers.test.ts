import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { pageConfig } from '@flarewatch/config';
import { handleSubscription } from '@/lib/subscriber-http';
import { stubMonitorWorker } from '../helpers/bindings';

const saved = { ...pageConfig };
afterEach(() => {
  Object.assign(pageConfig, saved);
  if (!saved.subscribers) delete pageConfig.subscribers;
});

function setup(extra: Partial<Cloudflare.Env> = {}) {
  pageConfig.subscribers = { from: 'status@example.com' };
  pageConfig.visibility = 'public';
  const limit = vi.fn(async () => ({ success: true }));
  const worker = vi.fn(async () => new Response('Check your inbox.'));
  stubMonitorWorker(worker, { SUBSCRIBE_RATE_LIMIT: { limit }, ...extra });
  return { limit, worker };
}

function request(action = '', body = 'email=person%40example.com', method = 'POST') {
  return new Request(`https://status.test/subscribe${action}`, {
    method,
    headers: {
      'CF-Connecting-IP': '192.0.2.1',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    ...(method === 'POST' && { body }),
  });
}

describe('subscriber HTTP routes', () => {
  it('returns the same response for new and existing addresses', async () => {
    const { worker } = setup();
    worker.mockResolvedValueOnce(new Response('new internal response'));
    worker.mockResolvedValueOnce(new Response('existing internal response'));
    const first = await handleSubscription(request(), 'subscribe');
    const second = await handleSubscription(request(), 'subscribe');
    expect(first.status).toBe(200);
    expect(await first.text()).toBe('Check your inbox.');
    expect(await second.text()).toBe('Check your inbox.');
    expect(second.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each(['subscribe', 'confirm', 'unsubscribe'] as const)(
    'rate limits %s before calling the monitor Worker',
    async (action) => {
      const { limit, worker } = setup();
      limit.mockResolvedValueOnce({ success: false });
      expect((await handleSubscription(request(), action)).status).toBe(429);
      expect(limit).toHaveBeenCalledWith({ key: '192.0.2.1' });
      expect(worker).not.toHaveBeenCalled();
    },
  );

  it('fails closed when the rate limiter is absent', async () => {
    setup({ SUBSCRIBE_RATE_LIMIT: undefined });
    expect((await handleSubscription(request(), 'subscribe')).status).toBe(503);
  });

  it('requires Turnstile only when its secret is set and checks the hostname', async () => {
    const { worker } = setup({ TURNSTILE_SECRET: 'test-secret' });
    const verify = vi.fn<typeof fetch>(async () =>
      Response.json({ success: true, hostname: 'status.test' }),
    );
    vi.stubGlobal('fetch', verify);
    expect((await handleSubscription(request(), 'subscribe')).status).toBe(400);
    expect(worker).not.toHaveBeenCalled();
    expect(
      (
        await handleSubscription(
          request('', 'email=a%40example.com&cf-turnstile-response=token'),
          'subscribe',
        )
      ).status,
    ).toBe(200);
    verify.mockResolvedValueOnce(Response.json({ success: true, hostname: 'elsewhere.test' }));
    expect(
      (
        await handleSubscription(
          request('', 'email=a%40example.com&cf-turnstile-response=token'),
          'subscribe',
        )
      ).status,
    ).toBe(400);
    setup();
    expect((await handleSubscription(request(), 'subscribe')).status).toBe(200);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify.mock.calls[0]?.[1]?.redirect).toBe('manual');
  });

  it('forwards the RFC 8058 one-click POST with the token and no cookies', async () => {
    const { worker } = setup();
    worker.mockResolvedValueOnce(new Response('Unsubscribed.'));
    const response = await handleSubscription(
      request('/unsubscribe?token=signed-token', 'List-Unsubscribe=One-Click'),
      'unsubscribe',
    );
    expect(await response.text()).toBe('Unsubscribed.');
    expect(worker).toHaveBeenCalledWith(
      'https://internal/subscribers/unsubscribe?token=signed-token',
      { method: 'POST' },
    );
    expect(
      (
        await handleSubscription(
          request('/unsubscribe?token=signed-token', 'wrong=body'),
          'unsubscribe',
        )
      ).status,
    ).toBe(400);
  });

  it('makes GET unsubscribe a confirmation page and never removes membership', async () => {
    const { worker } = setup();
    const response = await handleSubscription(
      request('/unsubscribe?token=abc', '', 'GET'),
      'unsubscribe',
    );
    expect(await response.text()).toContain('<button type="submit">Unsubscribe</button>');
    expect(worker).not.toHaveBeenCalled();
  });

  it('confirms only on a POST, so a mail scanner that opens the link changes nothing', async () => {
    const { worker } = setup();
    const page = await handleSubscription(request('/confirm?token=abc', '', 'GET'), 'confirm');
    expect(await page.text()).toContain('<button type="submit">Confirm</button>');
    expect(worker).not.toHaveBeenCalled();

    worker.mockResolvedValueOnce(new Response('Subscription confirmed.'));
    const confirmed = await handleSubscription(request('/confirm?token=abc', ''), 'confirm');
    expect(await confirmed.text()).toBe('Subscription confirmed.');
    expect(worker).toHaveBeenCalledWith('https://internal/subscribers/confirm?token=abc', {
      method: 'POST',
    });
  });

  it('accepts the multipart form that RFC 8058 recommends for one-click', async () => {
    const { worker } = setup();
    worker.mockResolvedValueOnce(new Response('Unsubscribed.'));
    const boundary = 'one-click-boundary';
    const multipart = (body: string) =>
      new Request('https://status.test/subscribe/unsubscribe?token=signed-token', {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      });
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="List-Unsubscribe"',
      '',
      'One-Click',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    expect(await (await handleSubscription(multipart(body), 'unsubscribe')).text()).toBe(
      'Unsubscribed.',
    );
    expect((await handleSubscription(multipart('not a form'), 'unsubscribe')).status).toBe(400);
  });

  it('rate limits unsubscribe by link, because mail providers share addresses', async () => {
    const { limit, worker } = setup();
    worker.mockResolvedValueOnce(new Response('Unsubscribed.'));
    await handleSubscription(
      request('/unsubscribe?token=signed-token', 'List-Unsubscribe=One-Click'),
      'unsubscribe',
    );
    await handleSubscription(request(), 'subscribe');
    expect(limit.mock.calls).toEqual([[{ key: 'signed-token' }], [{ key: '192.0.2.1' }]]);
  });

  it('refuses signup on private or disabled pages', async () => {
    setup();
    pageConfig.visibility = 'private';
    expect((await handleSubscription(request(), 'subscribe')).status).toBe(404);
    pageConfig.visibility = 'public';
    delete pageConfig.subscribers;
    expect((await handleSubscription(request(), 'subscribe')).status).toBe(404);
  });
});

it('rejects oversized form bodies before forwarding a truncated address', async () => {
  const { worker } = setup();
  const response = await handleSubscription(
    request('', `email=a%40example.com&padding=${'x'.repeat(4097)}`),
    'subscribe',
  );
  expect(response.status).toBe(413);
  expect(worker).not.toHaveBeenCalled();
});

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

  it('forwards confirmation and refuses signup on private or disabled pages', async () => {
    const { worker } = setup();
    worker.mockResolvedValueOnce(new Response('Subscription confirmed.'));
    expect(
      await (await handleSubscription(request('/confirm?token=abc', '', 'GET'), 'confirm')).text(),
    ).toBe('Subscription confirmed.');
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

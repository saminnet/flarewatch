import { expect, it, vi } from 'vite-plus/test';
import { subscriberMail } from '../src/notifications/subscriber-mail';
import { handleSubscriberRequest } from '../src/subscriber-routes';
import { runChecks } from '../src/index';
import { subscriberToken, verifySubscriberToken } from '../src/subscriber-tokens';
import { createHub, hubNamespace } from './helpers/hub';
import { createWorkerDeps } from './helpers/worker-deps';
import { check, down } from './helpers/check-records';

it('round-trips tokens and refuses tampering and a different action or secret', async () => {
  const token = await subscriberToken('secret', 'confirm', 'a+tag@example.com', '12');
  expect(await verifySubscriberToken('secret', 'confirm', token)).toEqual({
    email: 'a+tag@example.com',
    generation: '12',
  });
  expect(await verifySubscriberToken('secret', 'confirm', `${token.slice(0, -1)}x`)).toBeNull();
  expect(await verifySubscriberToken('secret', 'unsubscribe', token)).toBeNull();
  expect(await verifySubscriberToken('different', 'confirm', token)).toBeNull();
});

it('decides subscriber-only incidents after grace and sends no mail from the check run', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
  const { hub, db } = createHub();
  const monitor = check('api', down()).monitor;
  const network = vi.fn<() => Promise<Response>>(async () => {
    throw new Error('down');
  });
  const deps = {
    ...createWorkerDeps(
      { monitors: [monitor], notification: { gracePeriod: 1 } },
      { fetcher: network },
    ),
    pageConfig: { subscribers: { from: 'status@example.com' } },
  };
  await runChecks({ MONITOR_HUB: hubNamespace(hub) }, deps);
  expect(db.prepare('SELECT * FROM subscriber_outbox').all()).toHaveLength(0);
  vi.advanceTimersByTime(60000);
  await runChecks({ MONITOR_HUB: hubNamespace(hub) }, deps);
  expect(db.prepare('SELECT kind FROM subscriber_outbox').all()).toEqual([{ kind: 'down' }]);
  vi.advanceTimersByTime(60000);
  network.mockImplementation(async () => new Response('ok'));
  await runChecks({ MONITOR_HUB: hubNamespace(hub) }, deps);
  expect(db.prepare('SELECT kind FROM subscriber_outbox ORDER BY id').all()).toEqual([
    { kind: 'down' },
    { kind: 'recovered' },
  ]);
  expect(network).toHaveBeenCalledTimes(3);
});

it('validates tokens at the monitor Worker routes and keeps signup responses identical', async () => {
  const { hub } = createHub();
  const env = {
    MONITOR_HUB: hubNamespace(hub),
    SUBSCRIBER_SECRET: 'secret',
    RESEND_API_KEY: 'test',
    PUBLIC_ORIGIN: 'https://status.example.com',
  };
  const page = { subscribers: { from: 'status@example.com' } };
  const subscribe = () =>
    handleSubscriberRequest(
      new Request('https://internal/subscribers', {
        method: 'POST',
        body: JSON.stringify({ email: 'A+tag@EXAMPLE.com' }),
      }),
      env,
      page,
    );
  expect(await (await subscribe()).text()).toBe('Check your inbox.');
  expect(await (await subscribe()).text()).toBe('Check your inbox.');
  const token = await subscriberToken('secret', 'confirm', 'a+tag@example.com', '1');
  const confirm = await handleSubscriberRequest(
    new Request(`https://internal/subscribers/confirm?token=${encodeURIComponent(token)}`, {
      method: 'POST',
    }),
    env,
    page,
  );
  expect(confirm.status).toBe(200);
  expect(hub.subscriberCount()).toBe(1);
  const count = await handleSubscriberRequest(
    new Request('https://internal/subscribers/count'),
    { MONITOR_HUB: env.MONITOR_HUB },
    page,
  );
  expect(await count.json()).toEqual({ count: 1 });
  const invalid = await handleSubscriberRequest(
    new Request('https://internal/subscribers/unsubscribe?token=invalid', { method: 'POST' }),
    env,
    page,
  );
  expect(invalid.status).toBe(400);
  expect(hub.subscriberCount()).toBe(1);
  const remove = await subscriberToken('secret', 'unsubscribe', 'a+tag@example.com');
  expect(
    (
      await handleSubscriberRequest(
        new Request(
          `https://internal/subscribers/unsubscribe?token=${encodeURIComponent(remove)}`,
          { method: 'POST' },
        ),
        env,
        page,
      )
    ).status,
  ).toBe(200);
  expect(hub.subscriberCount()).toBe(0);
});

it('renders recovery minutes, UTC time and escaped HTML with working links', async () => {
  const message = await subscriberMail(
    'status@example.com',
    'https://status.example.com',
    'secret',
    'a@example.com',
    { kind: 'recovered', name: '<API>', start: 0, at: 61 },
  );
  expect(message.subject).toBe('<API> is up');
  expect(message.text).toContain('Downtime: 2 minutes');
  expect(message.text).toContain('Started: 1970-01-01T00:00:00.000Z');
  expect(message.html).toContain('&lt;API&gt; is up');
  expect(message.html).toContain('<a href="https://status.example.com/">');
  expect(message.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
});

it('accepts Cloudflare signup without a Resend key and requires its binding', async () => {
  const { hub } = createHub();
  const env = {
    MONITOR_HUB: hubNamespace(hub),
    SUBSCRIBER_SECRET: 'secret',
    PUBLIC_ORIGIN: 'https://status.example.com',
  };
  const page = { subscribers: { from: 'status@example.com', provider: 'cloudflare' as const } };
  const request = () =>
    new Request('https://internal/subscribers', {
      method: 'POST',
      body: JSON.stringify({ email: 'person@example.com' }),
    });
  expect((await handleSubscriberRequest(request(), env, page)).status).toBe(503);
  expect(
    (
      await handleSubscriberRequest(
        request(),
        { ...env, SUBSCRIBER_EMAIL: { async send() {} } },
        page,
      )
    ).status,
  ).toBe(200);
});

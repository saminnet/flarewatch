import { afterEach, expect, it, vi } from 'vite-plus/test';
import type { PullMonitor } from '@flarewatch/shared';
import { runChecks } from '../../src/index';
import { createNotifier } from '../../src/notifications/webhook';
import { createHub, hubNamespace } from '../helpers/hub';
import { createWorkerDeps } from '../helpers/worker-deps';
import { getEdgeLocation } from '../../src/utils/location';

const NOW = Date.parse('2025-01-15T01:37:00Z');
const monitor: PullMonitor = { id: 'a', name: 'Domain', method: 'DOMAIN', target: 'example.com' };
const bootstrap = { services: [[['com'], ['https://rdap.example/']]] };
const reply = (date = '2025-02-14T01:37:00Z') => ({
  objectClassName: 'domain',
  ldhName: 'example.com',
  events: [
    { eventAction: 'registration', eventDate: '2000-01-01T00:00:00Z' },
    { eventAction: 'expiration', eventDate: date },
  ],
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('checks a domain once daily by default and warns once at the thirty-day boundary', async () => {
  vi.useFakeTimers();
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(url);
      if (url === 'https://data.iana.org/rdap/dns.json') return Response.json(bootstrap);
      if (url === 'https://rdap.example/domain/example.com') return Response.json(reply());
      if (url === 'https://hooks.example/alert') return new Response('ok');
      return new Response('colo=HEL');
    }),
  );
  const { hub } = createHub();
  const env = { MONITOR_HUB: hubNamespace(hub) };
  const deps = {
    ...createWorkerDeps({
      monitors: [monitor],
      notification: { webhook: { url: 'https://hooks.example/alert', payload: { text: '$MSG' } } },
    }),
    createNotifier,
  };
  vi.setSystemTime(NOW - 60000);
  await runChecks(env, deps);
  expect(hub.view().monitors.a).toBeUndefined();
  vi.setSystemTime(NOW);
  await runChecks(env, deps);
  expect(hub.view().monitors.a).toMatchObject({
    status: 'degraded',
    warning: 'Domain expires on 2025-02-14 (30 days remaining)',
    incidents: [],
  });
  vi.setSystemTime(NOW + 60000);
  await runChecks(env, deps);
  expect(requests.filter((url) => url === 'https://data.iana.org/rdap/dns.json')).toHaveLength(1);
  expect(requests.filter((url) => url === 'https://hooks.example/alert')).toHaveLength(1);
});

it.each([
  [reply('2025-01-15T01:37:00Z'), 'Domain expired'],
  [reply('not a date'), 'Invalid expiration date'],
  [{ ...reply(), events: [] }, 'No expiration event'],
  [{ ...reply(), ldhName: 'other.com' }, 'registrable domain'],
  [{ broken: true }, 'Invalid RDAP response'],
])('fails a domain check for %j', async (body, error) => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) =>
      input === 'https://data.iana.org/rdap/dns.json'
        ? Response.json(bootstrap)
        : Response.json(body),
    ),
  );
  const { hub } = createHub();
  await runChecks(
    { MONITOR_HUB: hubNamespace(hub) },
    createWorkerDeps({ monitors: [{ ...monitor, checkEveryMinutes: 1 }] }),
  );
  expect(hub.view().monitors.a?.status).toBe('down');
  expect(hub.view().monitors.a?.incidents[0]?.error[0]).toContain(error);
});

it('names a TLD without RDAP and stops an oversized RDAP reply', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  let missing = true;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      if (input === 'https://data.iana.org/rdap/dns.json')
        return Response.json(missing ? { services: [] } : bootstrap);
      return new Response('x'.repeat(1048577));
    }),
  );
  const { hub } = createHub();
  const deps = createWorkerDeps({ monitors: [{ ...monitor, checkEveryMinutes: 1 }] });
  await runChecks({ MONITOR_HUB: hubNamespace(hub) }, deps);
  expect(hub.view().monitors.a?.incidents[0]?.error[0]).toContain('No RDAP service for TLD com');
  missing = false;
  vi.setSystemTime(NOW + 60000);
  await runChecks({ MONITOR_HUB: hubNamespace(hub) }, deps);
  expect(hub.view().monitors.a?.incidents[0]?.error[1]).toContain('over 1048576 bytes');
});

it('charges each RDAP redirect to the shared run budget', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  let follow = false;
  const fetched: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      fetched.push(url);
      if (url === 'https://cloudflare.com/cdn-cgi/trace') return new Response('colo=HEL');
      if (url === 'https://data.iana.org/rdap/dns.json') return Response.json(bootstrap);
      if (url === 'https://rdap.example/domain/example.com')
        return new Response(null, { status: 302, headers: { location: '/next' } });
      if (url === 'https://rdap.example/next') {
        follow = true;
        return Response.json(reply('2026-01-01T00:00:00Z'));
      }
      return Response.json({ Status: 0, Answer: [{ type: 1, data: '192.0.2.1' }] });
    }),
  );
  const { hub } = createHub();
  const env = { MONITOR_HUB: hubNamespace(hub) };
  const domain = { ...monitor, checkEveryMinutes: 1 };
  const dns: PullMonitor[] = Array.from({ length: 45 }, (_, i) => ({
    id: `dns${i}`,
    name: 'DNS',
    method: 'DNS',
    target: 'example.com',
  }));
  await runChecks(env, { ...createWorkerDeps({ monitors: [...dns, domain] }), getEdgeLocation });
  expect(follow).toBe(false);
  expect(fetched.length + 1).toBeLessThanOrEqual(50);
  expect(hub.view().monitors.a?.incidents[0]?.error[0]).toContain(
    'No run budget left for RDAP redirect',
  );
  vi.setSystemTime(NOW + 60000);
  await runChecks(env, { ...createWorkerDeps({ monitors: [domain] }), getEdgeLocation });
  expect(follow).toBe(true);
  expect(hub.view().monitors.a?.status).toBe('up');
  expect(hub.view().monitors.a?.warning).toBeUndefined();
});

it.each(['bootstrap-http', 'bootstrap-json', 'lookup-http', 'network', 'redirect'])(
  'names an RDAP %s failure',
  async (cause) => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        if (cause === 'network') throw new Error('Network unavailable');
        if (input === 'https://data.iana.org/rdap/dns.json')
          return cause === 'bootstrap-http'
            ? new Response('error', { status: 503 })
            : Response.json(cause === 'bootstrap-json' ? {} : bootstrap);
        return cause === 'redirect'
          ? new Response(null, { status: 302, headers: { location: 'file:///tmp/invalid' } })
          : new Response('error', { status: 404 });
      }),
    );
    const { hub } = createHub();
    await runChecks(
      { MONITOR_HUB: hubNamespace(hub) },
      createWorkerDeps({ monitors: [{ ...monitor, checkEveryMinutes: 1 }] }),
    );
    const error = hub.view().monitors.a?.incidents[0]?.error[0];
    expect(error).toContain(
      cause === 'bootstrap-http'
        ? 'RDAP bootstrap HTTP 503'
        : cause === 'bootstrap-json'
          ? 'Invalid RDAP bootstrap response'
          : cause === 'lookup-http'
            ? 'RDAP lookup HTTP 404'
            : cause === 'network'
              ? 'Network unavailable'
              : 'Invalid RDAP redirect',
    );
  },
);

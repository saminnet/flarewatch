import { afterEach, expect, it, vi } from 'vite-plus/test';
import type { PullMonitor } from '@flarewatch/shared';
import { runChecks } from '../../src/index';
import { createNotifier } from '../../src/notifications/webhook';
import { createHub, hubNamespace } from '../helpers/hub';
import { createWorkerDeps } from '../helpers/worker-deps';

afterEach(() => vi.unstubAllGlobals());

it('checks every expected DNS value and queries the configured JSON resolver', async () => {
  const monitors: PullMonitor[] = [
    {
      id: 'dns',
      name: 'DNS',
      method: 'DNS',
      target: 'example.com',
      dnsRecordType: 'MX',
      dnsExpected: ['10 mail.example.com.', '20 backup.example.com.'],
      dnsResolver: 'https://resolver.example/dns?key=public',
    },
  ];
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      Status: 0,
      Answer: [
        { type: 15, data: '10 mail.example.com.' },
        { type: 15, data: '20 backup.example.com.' },
      ],
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const { hub } = createHub();
  await runChecks(
    { MONITOR_HUB: hubNamespace(hub) },
    { ...createWorkerDeps({ monitors }), createNotifier },
  );
  expect(hub.view().monitors.dns?.status).toBe('up');
  const request = fetcher.mock.calls.find(
    ([url]) => typeof url === 'string' && url.startsWith('https://resolver.example/'),
  );
  expect(request?.[0]).toBe('https://resolver.example/dns?key=public&name=example.com&type=MX');
  expect(new Headers(request?.[1]?.headers).get('accept')).toBe('application/dns-json');
});

it.each([
  [{ Status: 3 }, 'NXDOMAIN'],
  [{ Status: 2 }, 'SERVFAIL'],
  [{ Status: 5 }, 'REFUSED'],
  [{ Status: 42 }, '42'],
  [{ Status: 0 }, 'No A records'],
  [{ Status: 0, Answer: [{ type: 28, data: '::1' }] }, 'No A records'],
  [{ Status: 0, Answer: [{ type: 1, data: '192.0.2.2' }] }, 'Missing expected DNS value'],
  [{ Answer: [] }, 'Invalid DNS response'],
])('records a DNS failure for %j', async (reply, error) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(reply)),
  );
  const monitor: PullMonitor = {
    id: 'dns',
    name: 'DNS',
    method: 'DNS',
    target: 'example.com',
    dnsExpected: ['192.0.2.1'],
  };
  const { hub } = createHub();
  await runChecks({ MONITOR_HUB: hubNamespace(hub) }, createWorkerDeps({ monitors: [monitor] }));
  expect(hub.view().monitors.dns?.status).toBe('down');
  expect(hub.view().monitors.dns?.incidents[0]?.error[0]).toContain(error);
});

it.each([
  ['A', 1, '192.0.2.1'],
  ['AAAA', 28, '2001:db8::1'],
  ['CNAME', 5, 'alias.example.'],
  ['MX', 15, '10 mail.example.'],
  ['TXT', 16, '"verification"'],
  ['NS', 2, 'ns.example.'],
  ['CAA', 257, '0 issue "ca.example"'],
] as const)(
  'passes a nonempty %s answer without expected values',
  async (dnsRecordType, type, data) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ Status: 0, Answer: [{ type, data }] })),
    );
    const { hub } = createHub();
    const monitor: PullMonitor = {
      id: 'dns',
      name: 'DNS',
      method: 'DNS',
      target: 'example.com',
      dnsRecordType,
    };
    await runChecks({ MONITOR_HUB: hubNamespace(hub) }, createWorkerDeps({ monitors: [monitor] }));
    expect(hub.view().monitors.dns?.status).toBe('up');
  },
);

it.each(['http', 'json', 'large', 'network'])('names a DNS %s failure', async (cause) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (cause === 'network') throw new Error('Network unavailable');
      return cause === 'http'
        ? new Response('error', { status: 503 })
        : new Response(cause === 'large' ? 'x'.repeat(1048577) : 'not json');
    }),
  );
  const { hub } = createHub();
  await runChecks(
    { MONITOR_HUB: hubNamespace(hub) },
    createWorkerDeps({
      monitors: [{ id: 'dns', name: 'DNS', method: 'DNS', target: 'example.com' }],
    }),
  );
  const error = hub.view().monitors.dns?.incidents[0]?.error[0];
  expect(error).toContain(
    cause === 'http'
      ? 'DNS resolver HTTP 503'
      : cause === 'large'
        ? 'over 1048576 bytes'
        : cause === 'network'
          ? 'Network unavailable'
          : 'DNS lookup failed',
  );
});

import { afterEach, expect, it, vi } from 'vite-plus/test';
import { isJsonObject } from '@flarewatch/shared';
import { runChecks } from '../src/index';
import { createNotifier } from '../src/notifications/webhook';
import { createHub, hubNamespace } from './helpers/hub';
import { createWorkerDeps } from './helpers/worker-deps';
import { getEdgeLocation } from '../src/utils/location';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each([2, 3])(
  'delivers alerts after the check deadline with summaryAfter=%i',
  async (summaryAfter) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = 1800000000000;
    vi.setSystemTime(start);
    const sent: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, init) => {
        if (input === 'https://hooks.example/all') {
          sent.push(typeof init?.body === 'string' ? init.body : '');
          return new Response('ok');
        }
        const completedAt = Date.now() + 55000;
        await Promise.resolve();
        vi.setSystemTime(completedAt);
        return new Response('down', { status: 503 });
      }),
    );
    const { hub } = createHub();
    const env = { MONITOR_HUB: hubNamespace(hub) };
    const deps = {
      ...createWorkerDeps({
        monitors: ['a', 'b'].map((id) => ({
          id,
          name: id,
          method: 'GET' as const,
          target: `https://${id}.example.com`,
        })),
        notification: {
          summaryAfter,
          webhook: { url: 'https://hooks.example/all', payload: { text: '$MSG' } },
        },
      }),
      createNotifier,
    };
    await runChecks(env, deps);
    expect(sent).toHaveLength(summaryAfter === 2 ? 1 : 2);
    vi.setSystemTime(start + 60000);
    await runChecks(env, deps);
    expect(sent).toHaveLength(summaryAfter === 2 ? 1 : 2);
  },
);

it.each([undefined, 8000])(
  'keeps the webhook timeout %s near the check deadline',
  async (timeout) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = 1800000000000;
    vi.setSystemTime(start);
    const timeouts: (number | undefined)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => {
        vi.setSystemTime(start + 54999);
        return new Response('down', { status: 503 });
      }),
    );
    const { hub } = createHub();
    const deps = {
      ...createWorkerDeps({
        monitors: ['a', 'b'].map((id) => ({
          id,
          name: id,
          method: 'GET' as const,
          target: `https://${id}.example.com`,
        })),
        notification: {
          summaryAfter: 2,
          webhook: {
            url: 'https://hooks.example/all',
            payload: '$MSG',
            ...(timeout !== undefined && { timeout }),
          },
        },
      }),
      createNotifier: (webhooks: Parameters<typeof createNotifier>[0]) =>
        createNotifier(webhooks, async (_url, options) => {
          timeouts.push(options?.timeout);
          return new Response('ok');
        }),
    };
    await runChecks({ MONITOR_HUB: hubNamespace(hub) }, deps);
    expect(timeouts).toEqual([timeout ?? 5000]);
  },
);

it('summarizes a mass outage per webhook within fifty requests and confirms every listed alert', async () => {
  const monitors = Array.from({ length: 40 }, (_, i) => ({
    id: `m${i}`,
    name: `Monitor ${i}`,
    method: 'GET' as const,
    target: `https://m${i}.example.com`,
  }));
  const sent: string[] = [];
  let requests = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      requests++;
      if (input === 'https://cloudflare.com/cdn-cgi/trace') return new Response('colo=HEL');
      if (typeof input === 'string' && input.startsWith('https://hooks.example/')) {
        sent.push(typeof init?.body === 'string' ? init.body : '');
        return new Response('ok');
      }
      return new Response('down', { status: 503 });
    }),
  );
  const { hub } = createHub();
  const deps = {
    ...createWorkerDeps({
      monitors,
      notification: {
        summaryAfter: 2,
        webhook: [
          { url: 'https://hooks.example/all', payload: { text: '$MSG' } },
          {
            url: 'https://hooks.example/subset',
            payload: { text: '$MSG' },
            monitors: ['m0', 'm1'],
          },
        ],
      },
    }),
    createNotifier,
    getEdgeLocation,
  };
  await runChecks({ MONITOR_HUB: hubNamespace(hub) }, deps);
  expect(sent).toHaveLength(2);
  for (const monitor of monitors) expect(sent[0]).toContain(monitor.name);
  expect(sent[1]).toContain('Monitor 0');
  expect(sent[1]).not.toContain('Monitor 2');
  expect(requests + 2).toBeLessThanOrEqual(50);
  const first = sent.length;
  await runChecks({ MONITOR_HUB: hubNamespace(hub) }, deps);
  expect(sent).toHaveLength(first);
});

it('keeps routing below the threshold and retries down alerts after a refused summary', async () => {
  let accept = false;
  const sent: { url: string; text: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      if (typeof input === 'string' && input.startsWith('https://hooks.example/')) {
        const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        sent.push({
          url: input,
          text: isJsonObject(body) && typeof body.text === 'string' ? body.text : '',
        });
        return new Response('reply', { status: accept ? 200 : 503 });
      }
      return new Response('down', { status: 503 });
    }),
  );
  const monitors = ['a', 'b'].map((id) => ({
    id,
    name: id,
    method: 'GET' as const,
    target: `https://${id}.example.com`,
  }));
  const { hub } = createHub();
  const deps = {
    ...createWorkerDeps({
      monitors,
      notification: {
        summaryAfter: 2,
        webhook: [
          { url: 'https://hooks.example/all', payload: { text: '$MSG' } },
          { url: 'https://hooks.example/a', payload: { text: '$MSG' }, monitors: ['a'] },
        ],
      },
    }),
    createNotifier,
  };
  const env = { MONITOR_HUB: hubNamespace(hub) };
  await runChecks(env, deps);
  expect(sent).toHaveLength(2);
  expect(sent[0]?.text).toContain('Down');
  expect(sent[1]?.text).toContain('a is down');
  accept = true;
  await runChecks(env, deps);
  expect(sent).toHaveLength(4);
  await runChecks(env, deps);
  expect(sent).toHaveLength(4);
});

it('sends the alerts that a run cannot fit one by one as a summary, for an outage and its recovery', async () => {
  const monitors = Array.from({ length: 40 }, (_, i) => ({
    id: `m${i}`,
    name: `Monitor ${i}`,
    method: 'GET' as const,
    target: `https://m${i}.example.com`,
  }));
  let down = true;
  let requests = 0;
  const sent: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      requests++;
      if (input === 'https://cloudflare.com/cdn-cgi/trace') return new Response('colo=HEL');
      if (input === 'https://hooks.example/all') {
        sent.push(typeof init?.body === 'string' ? init.body : '');
        return new Response('ok');
      }
      return down ? new Response('down', { status: 503 }) : new Response('ok');
    }),
  );
  const { hub } = createHub();
  const deps = {
    ...createWorkerDeps({
      monitors,
      notification: { webhook: { url: 'https://hooks.example/all', payload: { text: '$MSG' } } },
    }),
    createNotifier,
    getEdgeLocation,
  };
  const run = async () => {
    sent.length = 0;
    requests = 0;
    await runChecks({ MONITOR_HUB: hubNamespace(hub) }, deps);
    expect(requests).toBeLessThanOrEqual(50);
    return sent.join('\n');
  };

  const outage = await run();
  for (const monitor of monitors) expect(outage).toContain(monitor.name);

  down = false;
  vi.setSystemTime(Date.now() + 60_000);
  const recovery = await run();
  for (const monitor of monitors) expect(recovery).toContain(monitor.name);
  expect(sent.length).toBeGreaterThan(1);
});

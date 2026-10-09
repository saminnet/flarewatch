import { expect, it, vi } from 'vite-plus/test';
import type { MonitorTarget, FetchOptions } from '@flarewatch/shared';
import {
  normalizeMaintenance,
  isMaintenanceActive,
  maintenanceOccurrences,
  nextMaintenanceOccurrence,
} from '@flarewatch/shared';
import { runChecks } from '../src/index';
import { checkMonitor, runBudget } from '../src/checkers';
import { checkExternalProxy } from '../src/checkers/proxy';
import { GlobalPingChecker } from '../src/checkers/globalping';
import { getEdgeLocation } from '../src/utils/location';
import { HttpChecker } from '../src/checkers/http';
import { createNotifier } from '../src/notifications/webhook';
import { createHub, hubNamespace } from './helpers/hub';
import { visitorSnapshot } from '../../../apps/status-page/src/lib/public-view';
import { projectPublicData } from '../../../apps/status-page/src/lib/status-projection';

const NOW = 1736942400;
const TOKEN = 'proxy-secret-123456';
const monitor = (id: string): MonitorTarget => ({
  id,
  name: id,
  method: 'GET',
  target: `https://${id}.test`,
});
const policy = { gracePeriodSeconds: 0, skipIds: [], skipErrorChanges: false };

it('stored boundary recurrence cannot stop unrelated monitor recording', () => {
  const input = {
    body: 'x',
    start: 8639999996400000,
    end: 8640000000000000,
    repeat: { every: 'day', timeZone: 'Europe/Berlin' },
  };
  const normalized = normalizeMaintenance(input);
  expect(normalized).toHaveProperty('value');
  if (!('value' in normalized)) throw new Error('Fixture rejected');
  const { hub } = createHub();
  hub.putMaintenance({ ...normalized.value, id: 'bad', createdAt: 0, updatedAt: 0 });
  const records = ['first', 'second'].map((id) => ({
    monitor: monitor(id),
    check: { location: 'HEL', result: { ok: true as const, latency: 1 } },
  }));
  hub.record(NOW, records);
  expect(hub.view().lastUpdate).toBe(NOW);
  expect(Object.values(hub.view().monitors).map(({ status }) => status)).toEqual(['up', 'up']);
  expect(
    isMaintenanceActive({ ...input, repeat: { every: 'day', timeZone: 'UTC' } }, NOW * 1000),
  ).toBe(false);
  expect(
    isMaintenanceActive(
      {
        start: NOW * 1000,
        end: (NOW + 60) * 1000,
        repeat: { every: 'day', timeZone: 'Europe/Berlin' },
      },
      NOW * 1000,
    ),
  ).toBe(true);
  hub.deleteMaintenance('bad');
  hub.record(NOW + 60, records);
  expect(hub.view().lastUpdate).toBe(NOW + 60);
});

it('recurrence enumeration contains date-range overflow', () => {
  const maximum = 8640000000000000;
  const start = maximum - 3 * 86400000;
  const window = {
    start,
    end: start + 3600000,
    repeat: { every: 'day' as const, timeZone: 'Europe/Berlin' },
  };
  expect(() => maintenanceOccurrences(window, start, maximum)).not.toThrow();
  expect(nextMaintenanceOccurrence(window, maximum + 1)).toBeUndefined();
});

it.each(['missing colo', 'rejected trace'])(
  'one failed location lookup serves a whole run: %s',
  async (mode) => {
    vi.resetModules();
    const { getEdgeLocation } = await import('../src/utils/location');
    const { checkMonitor: check } = await import('../src/checkers');
    let traces = 0;
    let requests = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      if (++requests > 4) throw new Error('Modeled quota exhausted');
      if ((input instanceof Request ? input.url : input.toString()).includes('/cdn-cgi/trace')) {
        traces++;
        if (mode === 'rejected trace') throw new Error('trace unavailable');
        return new Response('fl=1\n');
      }
      return new Response('ok');
    });
    const { hub, db } = createHub();
    await runChecks(
      { MONITOR_HUB: hubNamespace(hub) },
      {
        checkMonitor: check,
        getEdgeLocation,
        createNotifier,
        staticConfig: { monitors: ['one', 'two', 'three'].map(monitor) },
      },
    );
    expect(traces).toBe(1);
    expect(requests).toBe(4);
    expect(hub.view().lastUpdate).toBeGreaterThan(0);
    expect(Object.values(hub.view().monitors).map(({ status }) => status)).toEqual([
      'up',
      'up',
      'up',
    ]);
    db.close();
  },
);

it('proxy location token stays out of visitor state and latency', async () => {
  const published = { ...monitor('published'), checkProxy: 'https://proxy.test' };
  const hidden = { ...published, id: 'hidden', private: true };
  vi.stubGlobal('fetch', async () =>
    Response.json({
      location: TOKEN,
      result: { ok: true, latency: 1 },
    }),
  );
  const { hub } = createHub();
  await runChecks(
    { MONITOR_HUB: hubNamespace(hub), FLAREWATCH_PROXY_TOKEN: TOKEN },
    {
      checkMonitor,
      createNotifier,
      getEdgeLocation: () => getEdgeLocation(async () => new Response('colo=HEL\n')),
      staticConfig: { monitors: [published, hidden] },
    },
  );
  const snapshot = visitorSnapshot({ monitors: [published, hidden] }, hub.view(), [], []);
  if (!snapshot.state) throw new Error('Missing recorded state');
  const projection = projectPublicData(snapshot.monitors, snapshot.state, snapshot.maintenances);
  expect(JSON.stringify(projection)).not.toContain(TOKEN);
  expect(JSON.stringify(snapshot)).not.toContain(TOKEN);
  expect(JSON.stringify(hub.latency(published.id, hub.view().lastUpdate))).not.toContain(TOKEN);
  expect(JSON.stringify(snapshot)).not.toContain('hidden');
  const failed = await checkExternalProxy(
    published,
    published.checkProxy,
    { FLAREWATCH_PROXY_TOKEN: TOKEN },
    async () =>
      Response.json({
        location: TOKEN,
        result: { ok: false, error: `failure ${TOKEN}`, latency: 1 },
      }),
  );
  expect(JSON.stringify(failed)).not.toContain(TOKEN);
});

it.each(['proxy', 'webhook', 'globalping'] as const)(
  'adapter redirects cannot spend hidden requests: %s',
  async (adapter) => {
    let hops = 0;
    const network = async (url: string, options?: FetchOptions): Promise<Response> => {
      let next = new URL(url);
      while (true) {
        if (++hops > 3) throw new Error('Modeled quota exhausted');
        const hop = /^\/\d+$/.test(next.pathname) ? Number(next.pathname.slice(1)) : 0;
        const response =
          hop < 2
            ? new Response(null, { status: 307, headers: { location: `/${hop + 1}` } })
            : Response.json({ location: 'HEL', result: { ok: true, latency: 1 } });
        if (response.status !== 307 || options?.redirect === 'manual') return response;
        if (options?.redirect === 'error') throw new TypeError('Redirect refused');
        next = new URL(response.headers.get('location') ?? '', next);
      }
    };
    const target = monitor('api');
    const budget = runBudget([target], 0);
    const spare = budget.subrequests;
    if (adapter === 'proxy') await checkExternalProxy(target, 'https://proxy.test', {}, network);
    if (adapter === 'globalping')
      await new GlobalPingChecker(network).check(target, 'globalping://dummy', budget);
    if (adapter === 'webhook')
      await createNotifier({ url: 'https://hook.test' }, network)?.send(
        {
          monitor: target,
          kind: 'down',
          incidentStartTime: NOW,
          currentTime: NOW,
          reason: 'down',
          timeZone: 'UTC',
          downtimeSeconds: 0,
          alsoDown: [],
        },
        'down',
      );
    expect(hops).toBe(1);
    expect(budget.subrequests).toBe(spare);
    hops = 0;
    const directBudget = { deadline: Date.now() + 55_000, subrequests: 1 };
    const direct = await new HttpChecker(network).check(
      { ...target, target: 'https://direct.test/0' },
      directBudget,
    );
    expect(direct).toMatchObject({ ok: false, error: 'No subrequests left in this check run' });
    expect(hops).toBe(2);
    expect(directBudget.subrequests).toBe(0);
  },
);

it('future proxy expiry dates retain at most 32 claims per monitor', async () => {
  const { hub, db } = createHub();
  const target = { ...monitor('ssl'), sslCheckEnabled: true };
  const record = async (i: number, expiryDate: number) => {
    const check = await checkExternalProxy(target, 'https://proxy.test', {}, async () =>
      Response.json({
        location: 'HEL',
        result: { ok: true, latency: 1, ssl: { expiryDate, daysUntilExpiry: 1 } },
      }),
    );
    return hub.record(NOW + i * 60, [{ monitor: target, check }], policy).alerts;
  };
  const first = await record(0, 4102444800);
  hub.confirmAlerts(first.map((alert) => ({ ...alert, delivered: true })));
  expect(await record(1, 4102444800)).toEqual([]);
  const deferred = await record(2, 4102444801);
  hub.confirmAlerts(deferred.map((alert) => ({ ...alert, delivered: false, deferred: true })));
  expect(await record(3, 4102444801)).toHaveLength(1);
  for (let i = 4; i < 38; i++) {
    const alerts = await record(i, 4102444800 + i);
    expect(alerts).toHaveLength(1);
    hub.confirmAlerts(alerts.map((alert) => ({ ...alert, delivered: true })));
  }
  hub.record(NOW + 91 * 86400, [
    { monitor: monitor('unrelated'), check: { location: 'HEL', result: { ok: true, latency: 1 } } },
  ]);
  expect(
    db.prepare('SELECT COUNT(*) AS count FROM expiry_alerts WHERE monitor_id = ?').get(target.id)
      ?.count,
  ).toBeLessThanOrEqual(32);
  expect(hub.view().monitors.unrelated?.status).toBe('up');
});

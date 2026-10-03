import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  type Fetcher,
  isJsonObject,
  type Maintenance,
  type MonitorTarget,
  type NotificationConfig,
  type WorkerConfig,
} from '@flarewatch/shared';
import type { Env } from '../src/env';
import Worker, { runChecks, type WorkerDeps } from '../src/index';
import { createNotifier, WebhookNotifier } from '../src/notifications/webhook';
import { createHub, hubNamespace } from './helpers/hub';
import { createWorkerDeps } from './helpers/worker-deps';

const checkMonitorMock = vi.fn<WorkerDeps['checkMonitor']>();
const getEdgeLocationMock = vi.fn<WorkerDeps['getEdgeLocation']>();
const notifierSendMock = vi.fn<WebhookNotifier['send']>();
const createNotifierMock = vi.fn<WorkerDeps['createNotifier']>();
const workerConfigMock: WorkerConfig = { monitors: [] };

const NOW_SECONDS = Date.parse('2025-01-15T12:00:00Z') / 1000;

function createMonitor(id = 'test-monitor'): MonitorTarget {
  return {
    id,
    name: `Monitor ${id}`,
    method: 'GET',
    target: `https://${id}.example.com`,
  };
}

/** A hub holding these maintenance windows, as the status page saves them. */
function createEnv(maintenances: Maintenance[] = []) {
  const { hub } = createHub();
  for (const maintenance of maintenances) hub.putMaintenance(maintenance);
  const env: Env = { MONITOR_HUB: hubNamespace(hub) };
  return { hub, env };
}

function createMaintenance(overrides: Partial<Maintenance> = {}): Maintenance {
  return {
    id: 'maintenance',
    body: 'Maintenance',
    start: new Date((NOW_SECONDS - 60) * 1000).toISOString(),
    createdAt: NOW_SECONDS * 1000,
    updatedAt: NOW_SECONDS * 1000,
    ...overrides,
  };
}

function setNotifications(overrides: Partial<NotificationConfig> = {}): void {
  workerConfigMock.notification = {
    webhook: { url: 'https://hooks.example.com' },
    ...overrides,
  };
}

function mockUp(): void {
  checkMonitorMock.mockResolvedValue({
    location: 'SFO',
    result: { ok: true, latency: 10 },
  });
}

function mockDown(): void {
  checkMonitorMock.mockResolvedValue({
    location: 'SFO',
    result: { ok: false, error: 'Unavailable' },
  });
}

async function runScheduled(env: Env): Promise<void> {
  await runChecks(env, {
    checkMonitor: checkMonitorMock,
    createNotifier: createNotifierMock,
    getEdgeLocation: getEdgeLocationMock,
    staticConfig: workerConfigMock,
  });
}

describe('scheduled handler', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards its env into runChecks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('colo=AMS\n')),
    );
    const { hub, env } = createEnv();

    await Worker.scheduled({} as ScheduledEvent, env, {} as ExecutionContext);

    expect(hub.view().lastUpdate).toBeGreaterThan(0);
  });
});

describe('subrequests per check run', () => {
  const PROXY = 'https://proxy.example.com/check';

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const HOOK = 'https://hooks.example.com/alert';

  /** Fetches and hub calls in one run of 45 monitors that confirm through a proxy. */
  async function countSubrequests(failing: number, notification?: NotificationConfig) {
    const monitors = Array.from({ length: 45 }, (_, i) => ({
      ...createMonitor(`m${i}`),
      confirmVia: PROXY,
    }));
    const down = new Set(monitors.slice(0, failing).map((monitor) => monitor.target));
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === PROXY) {
        return Response.json({ location: 'FRA', result: { ok: false, error: 'down' } });
      }
      return new Response('ok', { status: down.has(url) ? 503 : 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { hub, env } = createEnv();
    const record = vi.spyOn(hub, 'record');
    const confirmAlerts = vi.spyOn(hub, 'confirmAlerts');

    await runChecks(env, {
      ...createWorkerDeps({ monitors, ...(notification && { notification }) }),
      createNotifier,
    });

    const hubCalls = record.mock.calls.length + confirmAlerts.mock.calls.length;
    return {
      // The edge-location lookup adds one on a cold isolate; the test deps answer it without a fetch.
      total: fetchMock.mock.calls.length + hubCalls + 1,
      hubCalls,
      confirmations: fetchMock.mock.calls.filter(([input]) => input === PROXY).length,
      alerts: fetchMock.mock.calls.filter(([input]) => input === HOOK).length,
    };
  }

  it('stays under 50 with 10 of 45 monitors failing', async () => {
    const { total, hubCalls, confirmations } = await countSubrequests(10);

    expect(hubCalls).toBe(1);
    expect(confirmations).toBeGreaterThan(0);
    expect(total).toBeLessThan(50);
  });

  it('leaves each webhook a request that confirmations cannot spend', async () => {
    const { confirmations, alerts } = await countSubrequests(4, { webhook: { url: HOOK } });

    // 45 checks, the hub's record and alert confirmation, a cold edge lookup and one webhook.
    expect(45 + confirmations + 2 + 1 + 1).toBeLessThanOrEqual(50);
    expect(alerts).toBeGreaterThan(0);
  });

  it('sends a mass outage over the next runs and loses no alert to the request cap', async () => {
    const monitors = Array.from({ length: 40 }, (_, i) => createMonitor(`m${i}`));
    const hooks = ['https://a.example.com/alert', 'https://b.example.com/alert'];
    const alerted = new Map(hooks.map((hook) => [hook, [] as string[]]));
    let requests = 0;
    let refused = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, init) => {
        const url = input instanceof Request ? input.url : input.toString();
        // The free plan refuses the 48th request of an invocation; the hub's calls take the rest.
        if (++requests > 47) {
          refused++;
          throw new Error('Too many subrequests.');
        }
        const hook = alerted.get(url);
        if (!hook) return new Response('down', { status: 503 });
        const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        const text = isJsonObject(body) && typeof body.text === 'string' ? body.text : '';
        hook.push(/Monitor (m\d+)(?!\d)/.exec(text)?.[1] ?? '?');
        return new Response('ok');
      }),
    );
    const { env } = createEnv();
    const deps = {
      ...createWorkerDeps({
        monitors,
        notification: { webhook: hooks.map((url) => ({ url, payload: { text: '$MSG' } })) },
      }),
      createNotifier,
    };

    let runs = 0;
    do {
      requests = 0;
      await runChecks(env, deps);
    } while (++runs < 20 && requests > monitors.length);

    expect(refused).toBe(0);
    // 40 checks leave 7 requests: the prepaid alert and two more at two webhooks each.
    expect(runs).toBeLessThanOrEqual(15);
    const ids = monitors.map((monitor) => monitor.id).sort();
    for (const hook of hooks) expect(alerted.get(hook)?.sort()).toEqual(ids);
  });

  it('spends nothing on confirmations while every monitor is up', async () => {
    const { total, confirmations } = await countSubrequests(0);

    expect(confirmations).toBe(0);
    expect(total).toBe(45 + 1 + 1);
  });
});

describe('worker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_SECONDS * 1000));
    vi.clearAllMocks();

    workerConfigMock.monitors = [createMonitor()];
    delete workerConfigMock.notification;
    delete workerConfigMock.callbacks;

    getEdgeLocationMock.mockResolvedValue('SFO');
    const notifier = new WebhookNotifier({ url: 'https://hooks.example.com' }, vi.fn<Fetcher>());
    vi.spyOn(notifier, 'send').mockImplementation(notifierSendMock);
    createNotifierMock.mockImplementation((config) => (config ? notifier : null));
    notifierSendMock.mockResolvedValue([{ success: true }]);
    mockUp();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('notifications', () => {
    it('notifies on a status change when no grace period is configured', async () => {
      setNotifications();
      mockDown();
      const { env } = createEnv();

      await runScheduled(env);

      expect(notifierSendMock).toHaveBeenCalledTimes(1);
      expect(notifierSendMock.mock.calls[0]?.[0]).toMatchObject({
        monitor: { id: 'test-monitor' },
        kind: 'down',
        incidentStartTime: NOW_SECONDS,
        currentTime: NOW_SECONDS,
        downtimeSeconds: 0,
      });
      expect(notifierSendMock.mock.calls[0]?.[1]).toBe(
        '🔴 Monitor test-monitor is down\nDetected at 1/15, 12:00\nReason: Unavailable',
      );
    });

    it('does not notify before the grace period is reached', async () => {
      setNotifications({ gracePeriod: 1 });
      mockDown();
      const { env } = createEnv();

      await runScheduled(env);

      expect(notifierSendMock).not.toHaveBeenCalled();
    });

    it('suppresses notifications for an open-ended maintenance window', async () => {
      setNotifications();
      mockDown();
      const { env } = createEnv([createMaintenance({ monitors: [createMonitor().id] })]);

      await runScheduled(env);

      expect(notifierSendMock).not.toHaveBeenCalled();
    });

    it('suppresses only monitors included in a scoped maintenance window', async () => {
      const includedMonitor = createMonitor('included');
      const excludedMonitor = createMonitor('excluded');
      workerConfigMock.monitors = [includedMonitor, excludedMonitor];
      setNotifications();
      mockDown();
      const { env } = createEnv([
        createMaintenance({
          monitors: [includedMonitor.id],
          end: new Date((NOW_SECONDS + 60) * 1000).toISOString(),
        }),
      ]);

      await runScheduled(env);

      expect(notifierSendMock).toHaveBeenCalledTimes(1);
      expect(notifierSendMock.mock.calls[0]?.[0]).toMatchObject({
        monitor: { id: excludedMonitor.id },
      });
    });

    it('suppresses every monitor when a maintenance window lists no monitors', async () => {
      setNotifications();
      mockDown();
      const { env } = createEnv([createMaintenance({ monitors: [] })]);

      await runScheduled(env);

      expect(notifierSendMock).not.toHaveBeenCalled();
    });

    it('notifies outside the maintenance window', async () => {
      const monitor = createMonitor();
      setNotifications();
      mockDown();
      const { env } = createEnv([
        createMaintenance({
          monitors: [monitor.id],
          start: new Date((NOW_SECONDS + 3600) * 1000).toISOString(),
        }),
        createMaintenance({
          monitors: [monitor.id],
          start: new Date((NOW_SECONDS - 7200) * 1000).toISOString(),
          end: new Date((NOW_SECONDS - 3600) * 1000).toISOString(),
        }),
      ]);

      await runScheduled(env);

      expect(notifierSendMock).toHaveBeenCalledTimes(1);
    });

    it('suppresses only error-change notifications', async () => {
      setNotifications({ skipErrorChangeNotification: true });
      const { env } = createEnv();

      mockDown();
      await runScheduled(env);
      expect(notifierSendMock).toHaveBeenCalledTimes(1);

      checkMonitorMock.mockResolvedValue({
        location: 'SFO',
        result: { ok: false, error: 'DNS failure' },
      });
      await runScheduled(env);
      expect(notifierSendMock).toHaveBeenCalledTimes(1);

      mockUp();
      await runScheduled(env);
      expect(notifierSendMock).toHaveBeenCalledTimes(2);
      expect(notifierSendMock.mock.calls[1]?.[0]).toMatchObject({ kind: 'recovered' });
    });

    it('suppresses monitors in skipNotificationIds', async () => {
      setNotifications({ skipNotificationIds: ['test-monitor'] });
      mockDown();
      const { env } = createEnv();

      await runScheduled(env);

      expect(notifierSendMock).not.toHaveBeenCalled();
    });
  });

  describe('recording', () => {
    it('records the down incident in the hub', async () => {
      mockDown();
      const { hub, env } = createEnv();

      await runScheduled(env);

      expect(hub.view().monitors['test-monitor']).toMatchObject({
        status: 'down',
        incidents: [{ start: [NOW_SECONDS], error: ['Unavailable'] }],
      });
    });

    it('records the run despite a throwing status callback', async () => {
      mockDown();
      workerConfigMock.callbacks = {
        onStatusChange: vi.fn(async () => {
          throw new Error('callback exploded');
        }),
      };
      const { hub, env } = createEnv();

      await runScheduled(env);

      expect(hub.view().monitors['test-monitor']?.incidents).toHaveLength(1);
    });

    it('records private monitors like any other', async () => {
      const privateMonitor: MonitorTarget = { ...createMonitor('private-monitor'), private: true };
      workerConfigMock.monitors = [privateMonitor];
      mockDown();
      const { hub, env } = createEnv();

      await runScheduled(env);

      expect(hub.view().monitors[privateMonitor.id]?.status).toBe('down');
    });
  });

  it('throws when the MONITOR_HUB binding is missing', async () => {
    const { MONITOR_HUB: _hub, ...env } = createEnv().env;
    await expect(runScheduled(env)).rejects.toThrow('MONITOR_HUB binding not found');
  });
});

describe('hub routes for the status page', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_SECONDS * 1000));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const fetchRoute = (env: Env, path: string) =>
    Worker.fetch(new Request(`https://internal${path}`), env, {} as ExecutionContext, {
      checkMonitor: checkMonitorMock,
      createNotifier: createNotifierMock,
      getEdgeLocation: getEdgeLocationMock,
      staticConfig: workerConfigMock,
    });

  it('serves the hub view and one monitor latency, ids decoded', async () => {
    const { hub, env } = createEnv();
    const monitor = createMonitor('a/b c');
    hub.record(NOW_SECONDS, [
      { monitor, check: { location: 'SFO', result: { ok: true, latency: 42 } } },
    ]);

    const view = await fetchRoute(env, '/view');
    const latency = await fetchRoute(env, `/latency/${encodeURIComponent(monitor.id)}`);

    await expect(view.json()).resolves.toEqual(hub.view());
    await expect(latency.json()).resolves.toEqual([{ ping: 42, loc: 'SFO', time: NOW_SECONDS }]);
  });

  it('serves the maintenance windows alone, oldest start first', async () => {
    const late = createMaintenance({
      id: 'late',
      start: new Date(NOW_SECONDS * 1000).toISOString(),
    });
    const early = createMaintenance({ id: 'early' });
    const { env } = createEnv([late, early]);

    const response = await fetchRoute(env, '/maintenances');

    await expect(response.json()).resolves.toEqual([early, late]);
  });

  it('saves a valid maintenance window under its own id and deletes it once', async () => {
    const { hub, env } = createEnv();
    const maintenance = createMaintenance({ id: 'm 1' });
    const put = (path: string, body: unknown) =>
      Worker.fetch(
        new Request(`https://internal${path}`, { method: 'PUT', body: JSON.stringify(body) }),
        env,
        {} as ExecutionContext,
      );
    const remove = (path: string) =>
      Worker.fetch(
        new Request(`https://internal${path}`, { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

    expect((await put('/maintenances/m%201', { ...maintenance, body: '' })).status).toBe(400);
    expect((await put('/maintenances/other', maintenance)).status).toBe(400);
    expect((await put('/maintenances/m%201', maintenance)).status).toBe(204);
    expect(hub.view().maintenances).toEqual([maintenance]);

    expect((await remove('/maintenances/m%201')).status).toBe(204);
    expect((await remove('/maintenances/m%201')).status).toBe(404);
    expect(hub.view().maintenances).toEqual([]);
  });

  it('refuses a window past 100 and a body over 64 KiB with a 400', async () => {
    const { env } = createEnv(
      Array.from({ length: 100 }, (_, index) => createMaintenance({ id: `w${index}` })),
    );
    const put = (id: string, body: string) =>
      Worker.fetch(
        new Request(`https://internal/maintenances/${id}`, { method: 'PUT', body }),
        env,
        {} as ExecutionContext,
      );

    const full = await put('new', JSON.stringify(createMaintenance({ id: 'new' })));
    expect(full.status).toBe(400);
    await expect(full.json()).resolves.toEqual({ error: 'Too many maintenance windows' });

    const large = JSON.stringify({
      ...createMaintenance({ id: 'w1' }),
      pad: 'x'.repeat(64 * 1024),
    });
    expect((await put('w1', large)).status).toBe(400);
  });

  it('stores a window as normalized, with a padded time zone trimmed and a blank one as UTC', async () => {
    const { hub, env } = createEnv();
    const put = (id: string, timeZone: string) =>
      Worker.fetch(
        new Request(`https://internal/maintenances/${id}`, {
          method: 'PUT',
          body: JSON.stringify({
            ...createMaintenance({ id }),
            end: new Date(NOW_SECONDS * 1000).toISOString(),
            repeat: { every: 'day', timeZone },
          }),
        }),
        env,
        {} as ExecutionContext,
      );

    expect((await put('padded', ' Europe/Berlin ')).status).toBe(204);
    expect((await put('blank', '')).status).toBe(204);

    expect(hub.view().maintenances.map(({ id, repeat }) => [id, repeat])).toEqual([
      ['blank', { every: 'day' }],
      ['padded', { every: 'day', timeZone: 'Europe/Berlin' }],
    ]);
  });

  it('refuses an id whose percent-encoding is malformed', async () => {
    const { env } = createEnv();
    const send = (method: string, path: string) =>
      Worker.fetch(
        new Request(`https://internal${path}`, { method, body: method === 'PUT' ? '{}' : null }),
        env,
        {} as ExecutionContext,
      );

    expect((await fetchRoute(env, '/latency/%E0%A4%A')).status).toBe(400);
    expect((await send('PUT', '/maintenances/%ZZ')).status).toBe(400);
    expect((await send('DELETE', '/maintenances/%ZZ')).status).toBe(400);
  });
});

describe('trigger route for the status page', () => {
  const deps: WorkerDeps = {
    checkMonitor: checkMonitorMock,
    createNotifier: createNotifierMock,
    getEdgeLocation: getEdgeLocationMock,
    staticConfig: workerConfigMock,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    workerConfigMock.monitors = [createMonitor()];
    delete workerConfigMock.notification;
    delete workerConfigMock.callbacks;
    getEdgeLocationMock.mockResolvedValue('SFO');
    mockUp();
  });

  function trigger(env: Env, method: string) {
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) };
    const response = Worker.fetch(
      new Request('https://internal/trigger', { method }),
      env,
      ctx as typeof ctx & ExecutionContext,
      deps,
    );
    return { response, pending };
  }

  it('answers at once and records a full check run in the background', async () => {
    const { hub, env } = createEnv();

    const { response, pending } = trigger(env, 'POST');

    expect((await response).status).toBe(202);
    await Promise.all(pending);
    expect(hub.view().lastUpdate).toBeGreaterThan(0);
    expect(hub.view().monitors['test-monitor']?.status).toBe('up');
  });

  it('starts nothing on a GET', async () => {
    const { hub, env } = createEnv();

    const { response, pending } = trigger(env, 'GET');

    expect((await response).status).toBe(404);
    expect(pending).toEqual([]);
    expect(checkMonitorMock).not.toHaveBeenCalled();
    expect(hub.view().lastUpdate).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  type Fetcher,
  type Maintenance,
  type Monitor,
  type MonitorTarget,
  type NotificationConfig,
  type WorkerConfig,
} from '@flarewatch/shared';
import type { Env } from '../src/env';
import Worker, { runChecks, type WorkerDeps } from '../src/index';
import { WebhookNotifier } from '../src/notifications/webhook';
import { createHub, hubNamespace } from './helpers/hub';

const checkMonitorMock = vi.fn<WorkerDeps['checkMonitor']>();
const getEdgeLocationMock = vi.fn<WorkerDeps['getEdgeLocation']>();
const notifierSendMock = vi.fn<WebhookNotifier['send']>();
const createNotifierMock = vi.fn<WorkerDeps['createNotifier']>();
const formatNotificationMessageMock = vi.fn<WorkerDeps['formatNotificationMessage']>();
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

/** Records an earlier failed run, so the next run sees an open incident from incidentStartTime. */
function openIncident(
  env: ReturnType<typeof createEnv>,
  monitor: MonitorTarget,
  incidentStartTime: number,
) {
  env.hub.record(incidentStartTime, [
    { monitor, check: { location: 'SFO', result: { ok: false, error: 'Unavailable' } } },
  ]);
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
    formatNotificationMessage: formatNotificationMessageMock,
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
    notifierSendMock.mockResolvedValue([]);
    formatNotificationMessageMock.mockReturnValue('notification');
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
        isUp: false,
        incidentStartTime: NOW_SECONDS,
        currentTime: NOW_SECONDS,
      });
    });

    it('does not notify before the grace period is reached', async () => {
      setNotifications({ gracePeriod: 1 });
      mockDown();
      const { env } = createEnv();

      await runScheduled(env);

      expect(notifierSendMock).not.toHaveBeenCalled();
    });

    it('notifies for a status change after the grace period is reached', async () => {
      setNotifications({ gracePeriod: 1 });
      const test = createEnv();
      openIncident(test, createMonitor(), NOW_SECONDS - 90);

      await runScheduled(test.env);

      expect(notifierSendMock).toHaveBeenCalledTimes(1);
      expect(notifierSendMock.mock.calls[0]?.[0]).toMatchObject({
        isUp: true,
        incidentStartTime: NOW_SECONDS - 90,
      });
    });

    it('notifies for an unchanged outage at the buffered grace-period threshold', async () => {
      setNotifications({ gracePeriod: 2 });
      mockDown();
      const test = createEnv();
      openIncident(test, createMonitor(), NOW_SECONDS - 90);

      await runScheduled(test.env);

      expect(notifierSendMock).toHaveBeenCalledTimes(1);
      expect(notifierSendMock.mock.calls[0]?.[0]).toMatchObject({
        isUp: false,
        incidentStartTime: NOW_SECONDS - 90,
      });
    });

    it('suppresses an up transition when the outage ended before its grace period', async () => {
      setNotifications({ gracePeriod: 1 });
      const test = createEnv();
      openIncident(test, createMonitor(), NOW_SECONDS - 20);

      await runScheduled(test.env);

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
      expect(notifierSendMock.mock.calls[1]?.[0]).toMatchObject({ isUp: true });
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

  describe('check execution', () => {
    it('records a crashed check as down without aborting the run', async () => {
      const rejectedMonitor = createMonitor('rejected');
      const healthyMonitor = createMonitor('healthy');
      workerConfigMock.monitors = [rejectedMonitor, healthyMonitor];
      checkMonitorMock.mockImplementation(async (monitor: Monitor) => {
        if (monitor.id === rejectedMonitor.id) {
          throw new Error('Check crashed');
        }
        return { location: 'SFO', result: { ok: true, latency: 10 } };
      });
      const { hub, env } = createEnv();

      await runScheduled(env);

      const { monitors } = hub.view();
      expect(monitors.healthy?.status).toBe('up');
      expect(monitors.rejected).toMatchObject({
        status: 'down',
        incidents: [{ error: ['Check failed: Error: Check crashed'] }],
      });
    });
  });
});

describe('hub routes for the status page', () => {
  const fetchRoute = (env: Env, path: string) =>
    Worker.fetch(new Request(`https://internal${path}`), env, {} as ExecutionContext, {
      checkMonitor: checkMonitorMock,
      createNotifier: createNotifierMock,
      formatNotificationMessage: formatNotificationMessageMock,
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
});

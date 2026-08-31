import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  KV_KEYS,
  type Maintenance,
  type MonitorState,
  type MonitorTarget,
  type NotificationConfig,
  type WorkerConfig,
} from '@flarewatch/shared';

const checkMonitorMock = vi.fn();
const getEdgeLocationMock = vi.fn<() => Promise<string>>();
const notifierSendMock = vi.fn();
const createNotifierMock = vi.fn();
const formatNotificationMessageMock = vi.fn();
const loggerMock = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
const workerConfigMock: WorkerConfig = { monitors: [] };

vi.mock('../src/checkers', () => ({
  checkMonitor: checkMonitorMock,
}));

vi.mock('../src/utils/location', () => ({
  getEdgeLocation: getEdgeLocationMock,
}));

vi.mock('../src/notifications/webhook', () => ({
  createNotifier: createNotifierMock,
  formatNotificationMessage: formatNotificationMessageMock,
}));

vi.mock('@flarewatch/config/worker', () => ({
  workerConfig: workerConfigMock,
}));

vi.mock('@flarewatch/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@flarewatch/shared')>();
  return {
    ...actual,
    createLogger: () => loggerMock,
  };
});

const NOW_SECONDS = Date.parse('2025-01-15T12:00:00Z') / 1000;

function createMonitor(id = 'test-monitor'): MonitorTarget {
  return {
    id,
    name: `Monitor ${id}`,
    method: 'GET',
    target: `https://${id}.example.com`,
  };
}

function createState(overrides: Partial<MonitorState> = {}): MonitorState {
  return {
    lastUpdate: NOW_SECONDS,
    overallUp: 0,
    overallDown: 0,
    startedAt: {},
    incident: {},
    latency: {},
    ...overrides,
  };
}

function createDownState(
  monitor: MonitorTarget,
  incidentStartTime: number,
  lastUpdate = NOW_SECONDS,
): MonitorState {
  return createState({
    lastUpdate,
    startedAt: { [monitor.id]: incidentStartTime },
    incident: {
      [monitor.id]: [
        {
          start: [incidentStartTime],
          end: undefined,
          error: ['Unavailable'],
        },
      ],
    },
    latency: { [monitor.id]: { recent: [] } },
  });
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

function createKv(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  const get = vi.fn(async (key: string) => {
    if (!values.has(key)) return null;
    return structuredClone(values.get(key));
  });
  const put = vi.fn(async (key: string, value: string) => {
    values.set(key, value);
  });

  return { get, put };
}

function asKv(kv: ReturnType<typeof createKv>): KVNamespace {
  return kv as unknown as KVNamespace;
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

async function runScheduled(env: {
  CONFIG_KV?: KVNamespace;
  STATE_KV?: KVNamespace;
  FLAREWATCH_STATE?: KVNamespace;
}): Promise<void> {
  const { default: Worker } = await import('../src/index');
  await Worker.scheduled({} as ScheduledEvent, env, {} as ExecutionContext);
}

describe('worker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_SECONDS * 1000));
    vi.clearAllMocks();

    workerConfigMock.monitors = [createMonitor()];
    delete workerConfigMock.notification;
    delete workerConfigMock.kvWriteCooldownMinutes;
    delete workerConfigMock.callbacks;

    getEdgeLocationMock.mockResolvedValue('SFO');
    createNotifierMock.mockImplementation((config) => (config ? { send: notifierSendMock } : null));
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
      const stateKv = createKv({ [KV_KEYS.STATE]: createState() });

      await runScheduled({ STATE_KV: asKv(stateKv) });

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
      const stateKv = createKv({ [KV_KEYS.STATE]: createState() });

      await runScheduled({ STATE_KV: asKv(stateKv) });

      expect(notifierSendMock).not.toHaveBeenCalled();
    });

    it('notifies for a status change after the grace period is reached', async () => {
      const monitor = createMonitor();
      setNotifications({ gracePeriod: 1 });
      const stateKv = createKv({
        [KV_KEYS.STATE]: createDownState(monitor, NOW_SECONDS - 90),
      });

      await runScheduled({ STATE_KV: asKv(stateKv) });

      expect(notifierSendMock).toHaveBeenCalledTimes(1);
      expect(notifierSendMock.mock.calls[0]?.[0]).toMatchObject({
        isUp: true,
        incidentStartTime: NOW_SECONDS - 90,
      });
    });

    it('notifies for an unchanged outage at the buffered grace-period threshold', async () => {
      const monitor = createMonitor();
      setNotifications({ gracePeriod: 2 });
      mockDown();
      const stateKv = createKv({
        [KV_KEYS.STATE]: createDownState(monitor, NOW_SECONDS - 90),
      });

      await runScheduled({ STATE_KV: asKv(stateKv) });

      expect(notifierSendMock).toHaveBeenCalledTimes(1);
      expect(notifierSendMock.mock.calls[0]?.[0]).toMatchObject({
        isUp: false,
        incidentStartTime: NOW_SECONDS - 90,
      });
    });

    it('suppresses an up transition when the outage ended before its grace period', async () => {
      const monitor = createMonitor();
      setNotifications({ gracePeriod: 1 });
      const stateKv = createKv({
        [KV_KEYS.STATE]: createDownState(monitor, NOW_SECONDS - 20),
      });

      await runScheduled({ STATE_KV: asKv(stateKv) });

      expect(notifierSendMock).not.toHaveBeenCalled();
    });

    it('suppresses notifications for an open-ended maintenance window', async () => {
      const monitor = createMonitor();
      setNotifications();
      mockDown();
      const stateKv = createKv({
        [KV_KEYS.STATE]: createState(),
        [KV_KEYS.MAINTENANCES]: [createMaintenance({ monitors: [monitor.id] })],
      });

      await runScheduled({ STATE_KV: asKv(stateKv) });

      expect(notifierSendMock).not.toHaveBeenCalled();
    });

    it('suppresses only monitors included in a scoped maintenance window', async () => {
      const includedMonitor = createMonitor('included');
      const excludedMonitor = createMonitor('excluded');
      workerConfigMock.monitors = [includedMonitor, excludedMonitor];
      setNotifications();
      mockDown();
      const stateKv = createKv({
        [KV_KEYS.STATE]: createState(),
        [KV_KEYS.MAINTENANCES]: [
          createMaintenance({
            monitors: [includedMonitor.id],
            end: new Date((NOW_SECONDS + 60) * 1000).toISOString(),
          }),
        ],
      });

      await runScheduled({ STATE_KV: asKv(stateKv) });

      expect(notifierSendMock).toHaveBeenCalledTimes(1);
      expect(notifierSendMock.mock.calls[0]?.[0]).toMatchObject({
        monitor: { id: excludedMonitor.id },
      });
    });

    it('suppresses every monitor when a maintenance window lists no monitors', async () => {
      setNotifications();
      mockDown();
      const stateKv = createKv({
        [KV_KEYS.STATE]: createState(),
        [KV_KEYS.MAINTENANCES]: [createMaintenance({ monitors: [] })],
      });

      await runScheduled({ STATE_KV: asKv(stateKv) });

      expect(notifierSendMock).not.toHaveBeenCalled();
    });

    it('suppresses monitors in skipNotificationIds', async () => {
      setNotifications({ skipNotificationIds: ['test-monitor'] });
      mockDown();
      const stateKv = createKv({ [KV_KEYS.STATE]: createState() });

      await runScheduled({ STATE_KV: asKv(stateKv) });

      expect(notifierSendMock).not.toHaveBeenCalled();
    });
  });

  describe('state persistence', () => {
    it('saves state when a monitor status changes', async () => {
      mockDown();
      const stateKv = createKv({ [KV_KEYS.STATE]: createState() });

      await runScheduled({ STATE_KV: asKv(stateKv) });

      expect(stateKv.put).toHaveBeenCalledTimes(1);
      expect(stateKv.put).toHaveBeenCalledWith(KV_KEYS.STATE, expect.any(String));
    });

    it('saves state when the write cooldown has elapsed', async () => {
      const stateKv = createKv({
        [KV_KEYS.STATE]: createState({ lastUpdate: NOW_SECONDS - 180 }),
      });

      await runScheduled({ STATE_KV: asKv(stateKv) });

      expect(stateKv.put).toHaveBeenCalledTimes(1);
    });

    it('skips saving state when no status changed and the cooldown has not elapsed', async () => {
      const stateKv = createKv({
        [KV_KEYS.STATE]: createState({ lastUpdate: NOW_SECONDS - 60 }),
      });

      await runScheduled({ STATE_KV: asKv(stateKv) });

      expect(stateKv.put).not.toHaveBeenCalled();
    });
  });

  describe('configuration', () => {
    it('uses a valid runtime config from CONFIG_KV', async () => {
      const staticMonitor = createMonitor('static');
      const runtimeMonitor = createMonitor('runtime');
      workerConfigMock.monitors = [staticMonitor];
      const configKv = createKv({
        [KV_KEYS.CONFIG]: { monitors: [runtimeMonitor] },
      });
      const stateKv = createKv();

      await runScheduled({ CONFIG_KV: asKv(configKv), STATE_KV: asKv(stateKv) });

      expect(checkMonitorMock).toHaveBeenCalledTimes(1);
      expect(checkMonitorMock).toHaveBeenCalledWith(runtimeMonitor, expect.any(Object));
      expect(checkMonitorMock).not.toHaveBeenCalledWith(staticMonitor, expect.any(Object));
    });

    it('falls back to static config when CONFIG_KV contains invalid config', async () => {
      const staticMonitor = createMonitor('static');
      workerConfigMock.monitors = [staticMonitor];
      const configKv = createKv({
        [KV_KEYS.CONFIG]: { monitors: 'invalid' },
      });
      const stateKv = createKv();

      await runScheduled({ CONFIG_KV: asKv(configKv), STATE_KV: asKv(stateKv) });

      expect(checkMonitorMock).toHaveBeenCalledTimes(1);
      expect(checkMonitorMock).toHaveBeenCalledWith(staticMonitor, expect.any(Object));
    });
  });

  describe('state KV selection', () => {
    it('prefers STATE_KV over FLAREWATCH_STATE', async () => {
      const stateKv = createKv();
      const fallbackKv = createKv();

      await runScheduled({
        STATE_KV: asKv(stateKv),
        FLAREWATCH_STATE: asKv(fallbackKv),
      });

      expect(stateKv.get).toHaveBeenCalled();
      expect(stateKv.put).toHaveBeenCalled();
      expect(fallbackKv.get).not.toHaveBeenCalled();
      expect(fallbackKv.put).not.toHaveBeenCalled();
    });

    it('uses FLAREWATCH_STATE when STATE_KV is not bound', async () => {
      const fallbackKv = createKv();

      await runScheduled({ FLAREWATCH_STATE: asKv(fallbackKv) });

      expect(fallbackKv.get).toHaveBeenCalled();
      expect(fallbackKv.put).toHaveBeenCalled();
    });

    it('throws when neither state KV binding is available', async () => {
      await expect(runScheduled({})).rejects.toThrow(
        'STATE_KV (or FLAREWATCH_STATE) binding not found',
      );
    });
  });

  describe('check execution', () => {
    it('counts a rejected monitor check as down without aborting the run', async () => {
      const rejectedMonitor = createMonitor('rejected');
      const healthyMonitor = createMonitor('healthy');
      workerConfigMock.monitors = [rejectedMonitor, healthyMonitor];
      checkMonitorMock.mockImplementation(async (monitor: MonitorTarget) => {
        if (monitor.id === rejectedMonitor.id) {
          throw new Error('Check crashed');
        }
        return { location: 'SFO', result: { ok: true, latency: 10 } };
      });
      const stateKv = createKv();

      await runScheduled({ STATE_KV: asKv(stateKv) });

      expect(checkMonitorMock).toHaveBeenCalledTimes(2);
      expect(stateKv.put).toHaveBeenCalledTimes(1);
      const savedState = JSON.parse(stateKv.put.mock.calls[0]?.[1] as string) as MonitorState;
      expect(savedState.overallUp).toBe(1);
      expect(savedState.overallDown).toBe(1);
    });
  });
});

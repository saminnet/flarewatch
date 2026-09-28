import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  HEARTBEAT_RUN_HISTORY,
  formatUtcShort,
  type HeartbeatMonitor,
  type Fetcher,
  type MonitorView,
  type WorkerConfig,
} from '@flarewatch/shared';
import type { Env } from '../src/env';
import { runChecks } from '../src/index';
import { WebhookNotifier } from '../src/notifications/webhook';
import type { PingKind } from '../src/hub/heartbeat';
import { createHub, hubNamespace } from './helpers/hub';
import { asKv, createKv } from './helpers/kv';
import { createWorkerDeps } from './helpers/worker-deps';

const notifierSendMock = vi.fn<WebhookNotifier['send']>();
const workerConfigMock: WorkerConfig = { monitors: [] };

const NOW = Date.parse('2025-01-15T12:00:00Z') / 1000;
const heartbeat: HeartbeatMonitor = {
  id: 'backup',
  name: 'Nightly backup',
  method: 'HEARTBEAT',
  periodSeconds: 60,
  graceSeconds: 10,
};

function createHeartbeatKv() {
  const kv = createKv();
  const { hub } = createHub();
  return {
    ...kv,
    hub,
    ping(kind: PingKind, at: number, message?: string): void {
      hub.ping(heartbeat, kind, at, message);
    },
    monitor(): MonitorView | undefined {
      return hub.view().monitors[heartbeat.id];
    },
  };
}

function scheduledRun(env: Env): Promise<void> {
  const notifier = new WebhookNotifier({ url: 'https://hooks.example.com' }, vi.fn<Fetcher>());
  vi.spyOn(notifier, 'send').mockImplementation(notifierSendMock);
  return runChecks(env, {
    ...createWorkerDeps(workerConfigMock),
    createNotifier: (config) => (config ? notifier : null),
  });
}

function runScheduled(kv: ReturnType<typeof createHeartbeatKv>): Promise<void> {
  return scheduledRun({ FLAREWATCH_STATE: asKv(kv), MONITOR_HUB: hubNamespace(kv.hub) });
}

function setNow(timestamp: number): void {
  vi.setSystemTime(new Date(timestamp * 1000));
}

describe('heartbeat scheduled checks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setNow(NOW);
    vi.clearAllMocks();
    notifierSendMock.mockResolvedValue([{ success: true }]);
    workerConfigMock.monitors = [heartbeat];
    workerConfigMock.notification = {
      webhook: { url: 'https://hooks.example.com' },
      gracePeriod: 60,
    };
    delete workerConfigMock.callbacks;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens once after the deadline and closes once after recovery', async () => {
    const kv = createHeartbeatKv();
    kv.ping('success', NOW);

    await runScheduled(kv);
    expect(kv.monitor()?.heartbeat?.status).toBe('up');
    expect(notifierSendMock).not.toHaveBeenCalled();

    setNow(NOW + 71);
    await runScheduled(kv);
    const downState = kv.monitor();
    expect(downState?.heartbeat?.status).toBe('down');
    expect(downState?.incidents).toHaveLength(1);
    expect(downState?.incidents?.[0]?.error).toEqual([
      `No heartbeat since ${formatUtcShort(NOW)} (expected by ${formatUtcShort(NOW + 70)})`,
    ]);
    expect(notifierSendMock).toHaveBeenCalledTimes(1);

    kv.ping('success', NOW + 71);
    await runScheduled(kv);
    const recoveredState = kv.monitor();
    expect(recoveredState?.heartbeat?.status).toBe('up');
    expect(recoveredState?.incidents?.[0]?.end).toBe(NOW + 71);
    expect(notifierSendMock).toHaveBeenCalledTimes(2);
    expect(notifierSendMock.mock.calls.map(([ctx]) => ctx.isUp)).toEqual([false, true]);
  });

  it('opens from a fail signal with its message and closes after success', async () => {
    const kv = createHeartbeatKv();
    kv.ping('fail', NOW, 'restic check failed');

    await runScheduled(kv);
    expect(kv.monitor()?.incidents?.[0]?.error).toEqual(['Job reported failure']);
    expect(notifierSendMock).toHaveBeenCalledTimes(1);

    setNow(NOW + 1);
    kv.ping('success', NOW + 1);
    await runScheduled(kv);

    expect(kv.monitor()?.incidents?.[0]?.end).toBe(NOW + 1);
    expect(notifierSendMock).toHaveBeenCalledTimes(2);
  });

  it('stores pending without an incident, a start time or latency', async () => {
    const kv = createHeartbeatKv();

    await runScheduled(kv);

    const state = kv.monitor();
    expect(state?.heartbeat?.status).toBe('pending');
    expect(state).toEqual({ status: 'pending', incidents: [], heartbeat: { status: 'pending' } });
    expect(notifierSendMock).not.toHaveBeenCalled();
  });

  it('takes its status from each heartbeat phase', async () => {
    const kv = createHeartbeatKv();

    await runScheduled(kv);
    expect(kv.monitor()?.status).toBe('pending');

    setNow(NOW + 1);
    kv.ping('success', NOW - 120);
    kv.ping('start', NOW - 5);
    await runScheduled(kv);
    expect(kv.monitor()?.status).toBe('running');

    setNow(NOW + 2);
    kv.ping('success', NOW - 65);
    await runScheduled(kv);
    expect(kv.monitor()?.status).toBe('late');

    setNow(NOW + 3);
    kv.ping('fail', NOW, 'boom');
    await runScheduled(kv);
    expect(kv.monitor()?.status).toBe('down');
  });

  it('stays down when the job restarts inside an open overdue incident', async () => {
    const kv = createHeartbeatKv();
    kv.ping('success', NOW - 200);

    await runScheduled(kv);
    expect(kv.monitor()?.status).toBe('down');

    setNow(NOW + 1);
    kv.ping('start', NOW - 5);
    await runScheduled(kv);
    expect(kv.monitor()).toMatchObject({ status: 'down', heartbeat: { status: 'running' } });
  });

  it('marks late without opening an incident', async () => {
    const kv = createHeartbeatKv();
    kv.ping('success', NOW - 65);

    await runScheduled(kv);

    const state = kv.monitor();
    expect(state?.heartbeat?.status).toBe('late');
    expect(state?.status).toBe('late');
    expect(state?.incidents).toEqual([]);
    expect(notifierSendMock).not.toHaveBeenCalled();
  });

  it('lets a start extend the deadline without producing success', async () => {
    const kv = createHeartbeatKv();
    kv.ping('success', NOW - 120);
    kv.ping('start', NOW - 5);

    await runScheduled(kv);
    const runningState = kv.monitor();
    expect(runningState?.heartbeat).toMatchObject({
      status: 'running',
      deadline: NOW + 5,
    });
    expect(runningState?.incidents).toEqual([]);
    expect(runningState?.status).toBe('running');

    setNow(NOW + 6);
    await runScheduled(kv);
    expect(kv.monitor()?.heartbeat?.status).toBe('down');
    expect(kv.monitor()?.incidents).toHaveLength(1);
  });

  it('records one miss per skipped period across overdue ticks', async () => {
    const kv = createHeartbeatKv();
    kv.ping('success', NOW);

    await runScheduled(kv);
    expect(kv.monitor()?.heartbeat?.misses).toBeUndefined();
    expect(kv.monitor()?.heartbeat?.runs).toEqual([{ at: NOW, outcome: 'ok' }]);

    setNow(NOW + 71);
    await runScheduled(kv);
    expect(kv.monitor()?.heartbeat?.misses).toEqual([NOW + 70]);

    setNow(NOW + 75);
    await runScheduled(kv);
    expect(kv.monitor()?.heartbeat?.misses).toEqual([NOW + 70]);

    setNow(NOW + 131);
    await runScheduled(kv);
    expect(kv.monitor()?.heartbeat?.misses).toEqual([NOW + 70, NOW + 130]);

    setNow(NOW + 312);
    await runScheduled(kv);
    expect(kv.monitor()?.heartbeat?.misses).toEqual([
      NOW + 70,
      NOW + 130,
      NOW + 190,
      NOW + 250,
      NOW + 310,
    ]);
  });

  it('keeps the newest window when the catch-up exceeds the cap', async () => {
    const kv = createHeartbeatKv();
    kv.ping('success', NOW);

    setNow(NOW + 70 + 100 * 60 + 1);
    await runScheduled(kv);
    const misses = kv.monitor()?.heartbeat?.misses;
    expect(misses).toHaveLength(HEARTBEAT_RUN_HISTORY);
    expect(misses?.[misses.length - 1]).toBe(NOW + 70 + 100 * 60);
  });

  it('saves the state when a full miss history rolls forward', async () => {
    const kv = createHeartbeatKv();
    kv.ping('success', NOW);
    setNow(NOW + 70 + (HEARTBEAT_RUN_HISTORY - 1) * 60 + 1);
    await runScheduled(kv);
    expect(kv.monitor()?.heartbeat?.misses).toHaveLength(HEARTBEAT_RUN_HISTORY);

    setNow(NOW + 70 + HEARTBEAT_RUN_HISTORY * 60 + 1);
    await runScheduled(kv);
    const state = kv.monitor();
    expect(kv.hub.view().lastUpdate).toBe(NOW + 70 + HEARTBEAT_RUN_HISTORY * 60 + 1);
    expect(state?.heartbeat?.misses?.slice(-1)[0]).toBe(NOW + 70 + HEARTBEAT_RUN_HISTORY * 60);
  });

  it('saves state when misses grow without a status change', async () => {
    const kv = createHeartbeatKv();
    kv.ping('success', NOW);

    setNow(NOW + 71);
    await runScheduled(kv);
    expect(kv.monitor()?.heartbeat).toMatchObject({
      status: 'down',
      misses: [NOW + 70],
    });

    setNow(NOW + 131);
    await runScheduled(kv);
    const state = kv.monitor();
    expect(state?.heartbeat?.misses).toEqual([NOW + 70, NOW + 130]);
    expect(kv.hub.view().lastUpdate).toBe(NOW + 131);
  });

  it('stays late exactly at the deadline', async () => {
    const kv = createHeartbeatKv();
    kv.ping('success', NOW);

    setNow(NOW + 70);
    await runScheduled(kv);

    const state = kv.monitor();
    expect(state?.heartbeat).toMatchObject({ status: 'late', deadline: NOW + 70 });
    expect(state?.incidents).toEqual([]);
    expect(notifierSendMock).not.toHaveBeenCalled();
  });
});

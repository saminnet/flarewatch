import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  HEARTBEAT_RUN_HISTORY,
  formatUtcShort,
  heartbeatKvKey,
  KV_KEYS,
  type HeartbeatMonitor,
  type HeartbeatSignal,
  type Fetcher,
  type MonitorState,
  type WorkerConfig,
} from '@flarewatch/shared';
import type { Env } from '../src/env';
import { runChecks } from '../src/index';
import { WebhookNotifier } from '../src/notifications/webhook';
import oldState from './fixtures/state-v1.json';
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

function createHeartbeatKv(initial: Array<[string, unknown]> = []) {
  const kv = createKv(initial);
  return {
    ...kv,
    setSignal(signal: HeartbeatSignal): void {
      kv.values.set(heartbeatKvKey(heartbeat.id), structuredClone(signal));
    },
    signal(): HeartbeatSignal {
      const value = kv.values.get(heartbeatKvKey(heartbeat.id));
      if (value === undefined) throw new Error('Signal was not saved');
      return JSON.parse(
        typeof value === 'string' ? value : JSON.stringify(value),
      ) as HeartbeatSignal;
    },
    state(): MonitorState {
      const value = kv.values.get(KV_KEYS.STATE);
      if (typeof value !== 'string') throw new Error('State was not saved');
      return JSON.parse(value) as MonitorState;
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
  return scheduledRun({ FLAREWATCH_STATE: asKv(kv) });
}

function setNow(timestamp: number): void {
  vi.setSystemTime(new Date(timestamp * 1000));
}

describe('heartbeat scheduled checks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setNow(NOW);
    vi.clearAllMocks();
    notifierSendMock.mockResolvedValue([]);
    workerConfigMock.monitors = [heartbeat];
    workerConfigMock.notification = {
      webhook: { url: 'https://hooks.example.com' },
      gracePeriod: 60,
    };
    delete workerConfigMock.callbacks;
    delete workerConfigMock.kvWriteCooldownMinutes;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens once after the deadline and closes once after recovery', async () => {
    const kv = createHeartbeatKv();
    kv.setSignal({ lastSuccess: NOW });

    await runScheduled(kv);
    expect(kv.state().heartbeat?.[heartbeat.id]?.status).toBe('up');
    expect(notifierSendMock).not.toHaveBeenCalled();

    setNow(NOW + 71);
    await runScheduled(kv);
    const downState = kv.state();
    expect(downState.heartbeat?.[heartbeat.id]?.status).toBe('down');
    expect(downState.incident[heartbeat.id]).toHaveLength(1);
    expect(downState.incident[heartbeat.id]?.[0]?.error).toEqual([
      `No heartbeat since ${formatUtcShort(NOW)} (expected by ${formatUtcShort(NOW + 70)})`,
    ]);
    expect(notifierSendMock).toHaveBeenCalledTimes(1);

    kv.setSignal({ lastSuccess: NOW + 71 });
    await runScheduled(kv);
    const recoveredState = kv.state();
    expect(recoveredState.heartbeat?.[heartbeat.id]?.status).toBe('up');
    expect(recoveredState.incident[heartbeat.id]?.[0]?.end).toBe(NOW + 71);
    expect(notifierSendMock).toHaveBeenCalledTimes(2);
    expect(notifierSendMock.mock.calls.map(([ctx]) => ctx.isUp)).toEqual([false, true]);
  });

  it('opens from a fail signal with its message and closes after success', async () => {
    const kv = createHeartbeatKv();
    kv.setSignal({ lastFail: NOW, message: 'restic check failed' });

    await runScheduled(kv);
    expect(kv.state().incident[heartbeat.id]?.[0]?.error).toEqual(['Job reported failure']);
    expect(notifierSendMock).toHaveBeenCalledTimes(1);

    setNow(NOW + 1);
    kv.setSignal({ lastSuccess: NOW + 1 });
    await runScheduled(kv);

    expect(kv.state().incident[heartbeat.id]?.[0]?.end).toBe(NOW + 1);
    expect(notifierSendMock).toHaveBeenCalledTimes(2);
  });

  it('turns a corrupt signal into a down incident and counts it down', async () => {
    const kv = createHeartbeatKv();
    kv.values.set(heartbeatKvKey(heartbeat.id), { lastSuccess: 'yesterday' });

    await runScheduled(kv);

    const state = kv.state();
    expect(state.heartbeat?.[heartbeat.id]).toEqual({ status: 'down' });
    expect(state.incident[heartbeat.id]?.[0]?.error).toEqual([
      `Invalid heartbeat signal stored for ${heartbeat.id}`,
    ]);
    expect(state.overallDown).toBe(1);
    expect(notifierSendMock).toHaveBeenCalledTimes(1);
  });

  it('persists pending without check-result effects and counts it as up', async () => {
    const kv = createHeartbeatKv();

    await runScheduled(kv);

    const state = kv.state();
    expect(state.heartbeat?.[heartbeat.id]?.status).toBe('pending');
    expect(state.incident[heartbeat.id]).toBeUndefined();
    expect(state.latency[heartbeat.id]).toBeUndefined();
    expect(state.startedAt[heartbeat.id]).toBeUndefined();
    expect(state.overallUp).toBe(1);
    expect(state.overallDown).toBe(0);
    expect(notifierSendMock).not.toHaveBeenCalled();
  });

  it('counts every heartbeat phase so up plus down covers the public monitor', async () => {
    const kv = createHeartbeatKv();

    await runScheduled(kv);
    expect(kv.state()).toMatchObject({ overallUp: 1, overallDown: 0 });

    setNow(NOW + 1);
    kv.setSignal({ lastSuccess: NOW - 120, lastStart: NOW - 5 });
    await runScheduled(kv);
    expect(kv.state()).toMatchObject({ overallUp: 1, overallDown: 0 });

    setNow(NOW + 2);
    kv.setSignal({ lastSuccess: NOW - 65 });
    await runScheduled(kv);
    expect(kv.state()).toMatchObject({ overallUp: 1, overallDown: 0, overallLate: 1 });

    setNow(NOW + 3);
    kv.setSignal({ lastFail: NOW, message: 'boom' });
    await runScheduled(kv);
    expect(kv.state()).toMatchObject({ overallUp: 0, overallDown: 1, overallLate: 0 });
  });

  it('counts a restart inside an open overdue incident as down', async () => {
    const kv = createHeartbeatKv();
    kv.setSignal({ lastSuccess: NOW - 200 });

    await runScheduled(kv);
    expect(kv.state()).toMatchObject({ overallUp: 0, overallDown: 1 });

    setNow(NOW + 1);
    kv.setSignal({ lastSuccess: NOW - 200, lastStart: NOW - 5 });
    await runScheduled(kv);
    expect(kv.state()).toMatchObject({ overallUp: 0, overallDown: 1 });
  });

  it('counts late without opening an incident', async () => {
    const kv = createHeartbeatKv();
    kv.setSignal({ lastSuccess: NOW - 65 });

    await runScheduled(kv);

    const state = kv.state();
    expect(state.heartbeat?.[heartbeat.id]?.status).toBe('late');
    expect(state.overallLate).toBe(1);
    expect(state.incident[heartbeat.id]).toEqual([]);
    expect(notifierSendMock).not.toHaveBeenCalled();
  });

  it('lets a start extend the deadline without producing success', async () => {
    const kv = createHeartbeatKv();
    kv.setSignal({ lastSuccess: NOW - 120, lastStart: NOW - 5 });

    await runScheduled(kv);
    const runningState = kv.state();
    expect(runningState.heartbeat?.[heartbeat.id]).toMatchObject({
      status: 'running',
      deadline: NOW + 5,
    });
    expect(runningState.incident[heartbeat.id]).toBeUndefined();
    expect(runningState.overallUp).toBe(1);

    setNow(NOW + 6);
    await runScheduled(kv);
    expect(kv.state().heartbeat?.[heartbeat.id]?.status).toBe('down');
    expect(kv.state().incident[heartbeat.id]).toHaveLength(1);
  });

  it('records one miss per skipped period across overdue ticks', async () => {
    const kv = createHeartbeatKv();
    kv.setSignal({ lastSuccess: NOW });

    await runScheduled(kv);
    expect(kv.state().heartbeat?.[heartbeat.id]?.misses).toBeUndefined();
    expect(kv.signal().runs).toBeUndefined();

    setNow(NOW + 71);
    await runScheduled(kv);
    expect(kv.state().heartbeat?.[heartbeat.id]?.misses).toEqual([NOW + 70]);

    setNow(NOW + 75);
    await runScheduled(kv);
    expect(kv.state().heartbeat?.[heartbeat.id]?.misses).toEqual([NOW + 70]);

    setNow(NOW + 131);
    await runScheduled(kv);
    expect(kv.state().heartbeat?.[heartbeat.id]?.misses).toEqual([NOW + 70, NOW + 130]);

    setNow(NOW + 312);
    await runScheduled(kv);
    expect(kv.state().heartbeat?.[heartbeat.id]?.misses).toEqual([
      NOW + 70,
      NOW + 130,
      NOW + 190,
      NOW + 250,
      NOW + 310,
    ]);
  });

  it('keeps the newest window when the catch-up exceeds the cap', async () => {
    const kv = createHeartbeatKv();
    kv.setSignal({ lastSuccess: NOW });

    setNow(NOW + 70 + 100 * 60 + 1);
    await runScheduled(kv);
    const misses = kv.state().heartbeat?.[heartbeat.id]?.misses;
    expect(misses).toHaveLength(HEARTBEAT_RUN_HISTORY);
    expect(misses?.[misses.length - 1]).toBe(NOW + 70 + 100 * 60);
  });

  it('saves the state when a full miss history rolls forward', async () => {
    const kv = createHeartbeatKv();
    workerConfigMock.kvWriteCooldownMinutes = 60;
    kv.setSignal({ lastSuccess: NOW });
    setNow(NOW + 70 + (HEARTBEAT_RUN_HISTORY - 1) * 60 + 1);
    await runScheduled(kv);
    expect(kv.state().heartbeat?.[heartbeat.id]?.misses).toHaveLength(HEARTBEAT_RUN_HISTORY);

    setNow(NOW + 70 + HEARTBEAT_RUN_HISTORY * 60 + 1);
    await runScheduled(kv);
    const state = kv.state();
    expect(state.lastUpdate).toBe(NOW + 70 + HEARTBEAT_RUN_HISTORY * 60 + 1);
    expect(state.heartbeat?.[heartbeat.id]?.misses?.slice(-1)[0]).toBe(
      NOW + 70 + HEARTBEAT_RUN_HISTORY * 60,
    );
  });

  it('saves state when misses grow without a status change', async () => {
    const kv = createHeartbeatKv();
    workerConfigMock.kvWriteCooldownMinutes = 60;
    kv.setSignal({ lastSuccess: NOW });

    setNow(NOW + 71);
    await runScheduled(kv);
    expect(kv.state().heartbeat?.[heartbeat.id]).toMatchObject({
      status: 'down',
      misses: [NOW + 70],
    });

    setNow(NOW + 131);
    await runScheduled(kv);
    const state = kv.state();
    expect(state.heartbeat?.[heartbeat.id]?.misses).toEqual([NOW + 70, NOW + 130]);
    expect(state.lastUpdate).toBe(NOW + 131);
  });

  it('stays late exactly at the deadline', async () => {
    const kv = createHeartbeatKv();
    kv.setSignal({ lastSuccess: NOW });

    setNow(NOW + 70);
    await runScheduled(kv);

    const state = kv.state();
    expect(state.heartbeat?.[heartbeat.id]).toMatchObject({ status: 'late', deadline: NOW + 70 });
    expect(state.incident[heartbeat.id]).toEqual([]);
    expect(notifierSendMock).not.toHaveBeenCalled();
  });

  it('never loses a ping landing mid-tick', async () => {
    const kv = createHeartbeatKv();
    kv.setSignal({ lastSuccess: NOW });

    setNow(NOW + 71);
    await runScheduled(kv);
    expect(kv.state().heartbeat?.[heartbeat.id]).toMatchObject({
      status: 'down',
      misses: [NOW + 70],
    });

    // The ping lands after the checker reads the signal and before the state write.
    setNow(NOW + 75);
    const read = kv.get.getMockImplementation()!;
    kv.get.mockImplementation(async (key, options) => {
      const value = await read(key, options);
      if (key === heartbeatKvKey(heartbeat.id)) {
        kv.setSignal({ lastSuccess: NOW + 75, runs: [{ at: NOW + 75, outcome: 'ok' }] });
      }
      return value;
    });

    await runScheduled(kv);
    kv.get.mockImplementation(read);

    expect(kv.signal()).toEqual({
      lastSuccess: NOW + 75,
      runs: [{ at: NOW + 75, outcome: 'ok' }],
    });
    expect(kv.state().heartbeat?.[heartbeat.id]).toMatchObject({
      status: 'down',
      misses: [NOW + 70],
    });

    setNow(NOW + 76);
    await runScheduled(kv);
    expect(kv.state().heartbeat?.[heartbeat.id]).toMatchObject({
      status: 'up',
      misses: [NOW + 70],
    });
  });

  it('migrates an old state blob without losing its incidents', async () => {
    const kv = createHeartbeatKv([[KV_KEYS.STATE, oldState]]);

    await runScheduled(kv);

    const state = kv.state();
    expect(state.incident.legacy).toEqual(oldState.incident.legacy);
    expect(state.startedAt.legacy).toBe(oldState.startedAt.legacy);
    expect(state.latency.legacy).toEqual(oldState.latency.legacy);
    expect(state.sslCertificates?.legacy).toEqual(oldState.sslCertificates.legacy);
    expect(state.heartbeat?.[heartbeat.id]?.status).toBe('pending');
  });
});

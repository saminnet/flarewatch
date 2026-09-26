import { describe, expect, it, vi } from 'vite-plus/test';
import type { HeartbeatState, MonitorState } from '@flarewatch/shared';
import { deriveHeartbeat, fetchPingUrl, mergeHeartbeatRuns, runLatenessSec } from '@/lib/heartbeat';

const PERIOD = 3600;
const GRACE = 300;
const RUN_AT = 1_757_900_000;

const heartbeatMonitor = { id: 'backup', method: 'HEARTBEAT' } as const;

function stateWith(heartbeat?: HeartbeatState): MonitorState {
  return {
    lastUpdate: RUN_AT + 60,
    overallUp: 1,
    overallDown: 0,
    startedAt: {},
    incident: {},
    latency: {},
    ...(heartbeat && { heartbeat: { backup: heartbeat } }),
  };
}

describe('deriveHeartbeat', () => {
  it('returns null for a pull monitor', () => {
    expect(deriveHeartbeat({ id: 'backup', method: 'GET' }, stateWith())).toBeNull();
  });

  it('reports pending before the first signal arrives', () => {
    expect(deriveHeartbeat(heartbeatMonitor, stateWith())).toEqual({
      phase: 'pending',
      nowSec: RUN_AT + 60,
    });
    expect(deriveHeartbeat(heartbeatMonitor, stateWith({ status: 'pending' }))).toEqual({
      phase: 'pending',
      nowSec: RUN_AT + 60,
    });
  });

  it('exposes the last success and the worker deadline when up', () => {
    const state = stateWith({
      status: 'up',
      lastSuccess: RUN_AT,
      deadline: RUN_AT + PERIOD + GRACE,
    });

    expect(deriveHeartbeat(heartbeatMonitor, state)).toEqual({
      phase: 'up',
      nowSec: RUN_AT + 60,
      lastRunSec: RUN_AT,
      lastResult: 'success',
      deadlineSec: RUN_AT + PERIOD + GRACE,
    });
  });

  it('merges cron-detected misses with the ping runs, oldest first, capped at 90', () => {
    const runs = [
      { at: RUN_AT - 2 * PERIOD, outcome: 'ok' as const },
      { at: RUN_AT, outcome: 'ok' as const },
    ];
    const view = deriveHeartbeat(
      heartbeatMonitor,
      stateWith({ status: 'up', lastSuccess: RUN_AT, runs, misses: [RUN_AT - PERIOD] }),
    );

    expect(view?.runs).toEqual([
      { at: RUN_AT - 2 * PERIOD, outcome: 'ok' },
      { at: RUN_AT - PERIOD, outcome: 'miss' },
      { at: RUN_AT, outcome: 'ok' },
    ]);
    expect(
      mergeHeartbeatRuns(
        Array.from({ length: 95 }, (_, i) => ({
          at: i,
          outcome: 'ok' as const,
        })),
        [],
      ),
    ).toHaveLength(90);
  });

  it('derives next due from the last run, no grace', () => {
    const monitor = { id: 'backup', method: 'HEARTBEAT', periodSeconds: PERIOD } as const;
    const state = stateWith({
      status: 'up',
      lastSuccess: RUN_AT,
      deadline: RUN_AT + PERIOD + GRACE,
    });

    expect(deriveHeartbeat(monitor, state)).toMatchObject({
      nextDueSec: RUN_AT + PERIOD,
      deadlineSec: RUN_AT + PERIOD + GRACE,
    });
  });

  it('keeps the deadline inside the grace window when late', () => {
    const lastSuccess = RUN_AT - PERIOD - 100;
    const state = stateWith({
      status: 'late',
      lastSuccess,
      deadline: lastSuccess + PERIOD + GRACE,
    });
    const view = deriveHeartbeat(heartbeatMonitor, state);

    expect(view).toMatchObject({ phase: 'late', lastRunSec: lastSuccess });
    expect(view?.deadlineSec).toBe(lastSuccess + PERIOD + GRACE);
    expect(view!.deadlineSec! - lastSuccess).toBe(PERIOD + GRACE);
  });

  it('reports the start signal while a run is in flight', () => {
    const state = stateWith({
      status: 'running',
      lastSuccess: RUN_AT - PERIOD,
      lastStart: RUN_AT,
      deadline: RUN_AT + GRACE,
    });

    expect(deriveHeartbeat(heartbeatMonitor, state)).toEqual({
      phase: 'running',
      nowSec: RUN_AT + 60,
      lastRunSec: RUN_AT - PERIOD,
      lastResult: 'success',
      deadlineSec: RUN_AT + GRACE,
      startedSec: RUN_AT,
    });
  });

  it('reports the missed deadline when no heartbeat arrived', () => {
    const lastSuccess = RUN_AT - 2 * PERIOD;
    const state = stateWith({
      status: 'down',
      lastSuccess,
      deadline: lastSuccess + PERIOD + GRACE,
    });

    expect(deriveHeartbeat(heartbeatMonitor, state)).toEqual({
      phase: 'down',
      nowSec: RUN_AT + 60,
      lastRunSec: lastSuccess,
      lastResult: 'success',
      deadlineSec: lastSuccess + PERIOD + GRACE,
    });
  });

  it('derives the last run duration from the run, not from lastStart', () => {
    const state = stateWith({
      status: 'up',
      lastSuccess: RUN_AT,
      runs: [
        { at: RUN_AT - PERIOD, outcome: 'ok' as const, startedAt: RUN_AT - PERIOD - 500 },
        { at: RUN_AT, outcome: 'ok' as const, startedAt: RUN_AT - 600 },
      ],
    });

    expect(deriveHeartbeat(heartbeatMonitor, state)).toMatchObject({ lastDurationSec: 600 });
  });

  it('ignores unusable startedAt, keeps fail duration', () => {
    const stale = stateWith({
      status: 'up',
      lastSuccess: RUN_AT,
      lastStart: RUN_AT - 600,
      runs: [{ at: RUN_AT, outcome: 'ok' as const }],
    });
    expect(deriveHeartbeat(heartbeatMonitor, stale)).not.toHaveProperty('lastDurationSec');

    const failed = stateWith({
      status: 'down',
      lastSuccess: RUN_AT - PERIOD,
      lastFail: RUN_AT,
      runs: [
        { at: RUN_AT - PERIOD, outcome: 'ok' as const },
        { at: RUN_AT, outcome: 'fail' as const, startedAt: RUN_AT - 42 },
      ],
    });
    expect(deriveHeartbeat(heartbeatMonitor, failed)).toMatchObject({ lastDurationSec: 42 });

    const negative = stateWith({
      status: 'up',
      lastSuccess: RUN_AT,
      runs: [{ at: RUN_AT, outcome: 'ok' as const, startedAt: RUN_AT + 5 }],
    });
    expect(deriveHeartbeat(heartbeatMonitor, negative)).not.toHaveProperty('lastDurationSec');

    const overdue = stateWith({
      status: 'down',
      lastSuccess: RUN_AT,
      misses: [RUN_AT + PERIOD + GRACE],
      runs: [{ at: RUN_AT, outcome: 'ok' as const, startedAt: RUN_AT - 90 }],
    });
    expect(deriveHeartbeat(heartbeatMonitor, overdue)).toMatchObject({ lastDurationSec: 90 });
  });

  it('carries the reported failure message and drops an empty one', () => {
    const base = { status: 'down', lastSuccess: RUN_AT - PERIOD, lastFail: RUN_AT } as const;

    expect(
      deriveHeartbeat(heartbeatMonitor, stateWith({ ...base, message: 'restic check failed' })),
    ).toMatchObject({ phase: 'down', lastResult: 'fail', message: 'restic check failed' });

    expect(
      deriveHeartbeat(heartbeatMonitor, stateWith({ ...base, message: '' })),
    ).not.toHaveProperty('message');
  });

  it('prefers the newer failure over an older success', () => {
    const state = stateWith({
      status: 'down',
      lastSuccess: RUN_AT - PERIOD,
      lastFail: RUN_AT,
      deadline: RUN_AT - PERIOD + PERIOD + GRACE,
    });

    expect(deriveHeartbeat(heartbeatMonitor, state)).toMatchObject({
      phase: 'down',
      lastRunSec: RUN_AT,
      lastResult: 'fail',
    });
  });
});

describe('runLatenessSec', () => {
  const period = 3600;
  const grace = 300;

  it('measures lateness past period plus grace, skipping miss and fail entries', () => {
    const runs = [
      { at: RUN_AT, outcome: 'ok' as const },
      { at: RUN_AT + period, outcome: 'miss' as const },
      { at: RUN_AT + period + 1800, outcome: 'late' as const },
    ];

    // [ok, miss, late]: the recovery is 30m late by the old period-only
    // measure, but the checker calls it late only past grace, so 25m.
    expect(runLatenessSec(runs, 2, period, grace)).toBe(1500);
  });

  it('reports zero inside grace, on time, first, or without a period', () => {
    const runs = [
      { at: RUN_AT, outcome: 'ok' as const },
      { at: RUN_AT + period + 100, outcome: 'late' as const },
    ];

    expect(runLatenessSec(runs, 1, period, grace)).toBe(0);
    expect(runLatenessSec([{ at: RUN_AT, outcome: 'late' }], 0, period, grace)).toBe(0);
    expect(runLatenessSec(runs, 1, undefined, grace)).toBe(0);
  });
});

const ORIGIN = 'https://status.test';

describe('fetchPingUrl', () => {
  it('returns the ping URL built by the monitoring worker', async () => {
    const fetch = vi.fn<Fetcher['fetch']>(async () =>
      Response.json({ url: 'https://status.test/ping/backup/t0k3n' }),
    );

    const url = await fetchPingUrl({ fetch, connect: vi.fn() }, ORIGIN, 'backup');

    expect(url).toBe('https://status.test/ping/backup/t0k3n');
    expect(fetch).toHaveBeenCalledWith('https://status.test/ping-url/backup');
  });

  it('returns null when the monitoring worker is not bound', async () => {
    await expect(fetchPingUrl(undefined, ORIGIN, 'backup')).resolves.toBeNull();
  });

  it('returns null when the monitoring worker rejects the id', async () => {
    const fetch = vi.fn<Fetcher['fetch']>(async () => new Response('Not Found', { status: 404 }));

    await expect(fetchPingUrl({ fetch, connect: vi.fn() }, ORIGIN, 'ghost')).resolves.toBeNull();
  });
});

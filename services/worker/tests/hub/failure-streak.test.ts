import { expect, it } from 'vite-plus/test';
import {
  FailureStreakState,
  stepFailureStreak,
  type FailureStreak,
} from '../../src/hub/failure-streak';
import baseline from '../fixtures/hub-lifecycle-logs.json';

it('replays the captured missing-check and threshold log', () => {
  let state: FailureStreak = { state: FailureStreakState.Clear };
  const log = baseline.find(({ name }) => name === 'missing check and threshold')!.log;
  for (const entry of log) {
    if (!('records' in entry) || !entry.records) continue;
    const record = entry.records[0];
    const result = record && 'check' in record ? record.check.result : undefined;
    if (!result) {
      expect(entry.updates).toEqual([]);
      continue;
    }
    const transition = stepFailureStreak(state, {
      type: result.ok ? 'passed' : 'failed',
      now: entry.now!,
      heartbeat: false,
      hasOpenIncident: false,
      threshold: 3,
    });
    state = transition.next;
    expect(transition.apply).toBe(entry.updates!.length > 0);
    if (entry.updates![0]?.changeType === 'down') expect(transition.first).toBe(1240);
  }
});

it('bypasses a streak for heartbeats and open incidents', () => {
  const state = { state: FailureStreakState.Counting, count: 1, first: 1000 } as const;
  for (const [heartbeat, hasOpenIncident] of [
    [true, false],
    [false, true],
  ]) {
    expect(
      stepFailureStreak(state, {
        type: 'failed',
        now: 1060,
        heartbeat: heartbeat!,
        hasOpenIncident: hasOpenIncident!,
        threshold: 3,
      }),
    ).toEqual({ next: state, write: false, apply: true, first: 1060 });
  }
});

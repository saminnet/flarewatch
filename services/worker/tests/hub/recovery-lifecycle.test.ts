import { expect, it } from 'vite-plus/test';
import { RecoveryState, stepRecovery, type Recovery } from '../../src/hub/recovery-lifecycle';
import { capturedLifecycle } from '../helpers/captured-lifecycle';

it.each(['attempted', 'deferred'] as const)('ignores %s from a lost recovery owner', (type) => {
  const current: Recovery = { state: RecoveryState.Claimed, incident: 1, run: 2, at: 2200 };
  expect(stepRecovery(current, { type, incident: 1, run: 1 })).toEqual({
    next: current,
    effect: 'none',
  });
});

it('replays captured recovery ownership, disposition and cancellation logs', () => {
  for (const name of [
    'recovery ownership',
    'recovery accepted',
    'recovery refused',
    'recovery deferred',
    'recovery cancelled by reopen',
    'recovery cancelled by removal',
    'recovery cancelled by skip',
    'recovery cancelled by policy removal',
  ]) {
    let state: Recovery = { state: RecoveryState.Absent };
    let run = 0;

    for (const entry of capturedLifecycle(name)) {
      for (const outcome of entry.outcomes ?? []) {
        if (outcome.kind === 'recovered')
          state = stepRecovery(state, {
            type: outcome.deferred ? 'deferred' : 'attempted',
            incident: 1,
            run: outcome.run,
          }).next;
      }
      if (!entry.now) continue;
      run++;
      if (entry.updates?.some((update) => update.changeType === 'up'))
        state = { state: RecoveryState.Queued, incident: 1 };
      const alerting =
        entry.policy != null &&
        !entry.policy.skipIds.includes('api') &&
        !entry.token.startsWith('D') &&
        entry.token !== 'remove';
      const transition = stepRecovery(
        state,
        alerting ? { type: 'eligible', now: entry.now, run } : { type: 'cancelled' },
      );
      state = transition.next;
      expect(transition.effect === 'claim', name).toBe(
        entry.alerts?.some((alert) => alert.kind === 'recovered') ?? false,
      );
    }
  }
});

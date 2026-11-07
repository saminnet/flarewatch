import { expect, it } from 'vite-plus/test';
import { DownAlertState, stepDownAlert, type DownAlert } from '../../src/hub/down-alert-lifecycle';
import baseline from '../fixtures/hub-lifecycle-logs.json';

it.each(['delivered', 'refused', 'deferred'] as const)(
  'ignores %s from a lost down owner',
  (type) => {
    const current: DownAlert = {
      state: DownAlertState.Sending,
      attempts: 2,
      claimedAt: 2200,
      run: 2,
    };
    expect(stepDownAlert(current, { type, run: 1 })).toEqual({ next: current, claim: false });
  },
);

it('replays captured down claims, leases, stale outcomes, deferrals and refusal limit', () => {
  for (const name of [
    'live down lease and lost owner',
    'recorded refusal limit',
    'abandoned down claims',
    'deferred down',
    'reopen during down send',
    'acknowledgement suppresses reminders',
  ]) {
    let state: DownAlert = {
      state: DownAlertState.Pending,
      attempts: 0,
      claimedAt: null,
      run: null,
    };
    let run = 0;
    for (const entry of baseline.find((log) => log.name === name)!.log) {
      if ('outcomes' in entry && entry.outcomes) {
        for (const outcome of entry.outcomes) {
          if (outcome.kind !== 'down') continue;
          state = stepDownAlert(state, {
            type: 'deferred' in outcome ? 'deferred' : outcome.delivered ? 'delivered' : 'refused',
            run: outcome.run,
          }).next;
        }
      } else if (entry.now) {
        if (run > 0 && entry.updates?.some((update) => update.changeType === 'down'))
          state = stepDownAlert(state, { type: 'reopened' }).next;
        run++;
        const transition = entry.token.startsWith('D')
          ? stepDownAlert(state, { type: 'eligible', now: entry.now, run })
          : { next: state, claim: false };
        state = transition.next;
        expect(transition.claim, name).toBe(
          entry.alerts?.some((alert) => alert.kind === 'down') ?? false,
        );
      }
    }
    if (name === 'recorded refusal limit')
      expect(state).toMatchObject({ state: DownAlertState.Failed, attempts: 10 });
    if (name === 'abandoned down claims') expect(state.attempts).toBe(0);
  }
});

import { expect, it } from 'vite-plus/test';
import {
  ErrorFollowUpState,
  ReminderState,
  stepErrorFollowUp,
  stepReminder,
  type ErrorFollowUp,
  type Reminder,
} from '../../src/hub/follow-up-lifecycle';
import { capturedLifecycle } from '../helpers/captured-lifecycle';

it.each(['refused', 'deferred'] as const)('ignores %s from an older error generation', (type) => {
  const current: ErrorFollowUp = {
    state: ErrorFollowUpState.Idle,
    count: 2,
    run: 4,
    generation: 2000,
  };
  expect(stepErrorFollowUp(current, { type, run: 4, generation: 1000 })).toEqual({
    next: current,
    claim: false,
  });
});

it('replays captured error caps, refusal, deferral, ordering and generation fences', () => {
  for (const name of [
    'error cap',
    'deferred error',
    'refused error',
    'error generation fence',
    'error relapse continuity',
    'error outcome ordering',
    'duplicate error outcomes',
  ]) {
    let state: ErrorFollowUp = {
      state: ErrorFollowUpState.Idle,
      count: 0,
      run: null,
      generation: null,
    };
    let sent = false;
    let run = 0;
    for (const entry of capturedLifecycle(name)) {
      for (const outcome of entry.outcomes ?? []) {
        if (outcome.kind === 'down' && outcome.delivered) sent = true;
        if (outcome.kind === 'error')
          state = stepErrorFollowUp(state, {
            type: outcome.deferred ? 'deferred' : outcome.delivered ? 'delivered' : 'refused',
            run: outcome.run,
            generation: outcome.reopenedAt,
          }).next;
      }
      if (!entry.now) continue;
      run++;
      const generation = entry.alerts?.find((alert) => alert.kind === 'down')?.reopenedAt;
      if (generation != null && generation !== state.generation) {
        state = stepErrorFollowUp(state, { type: 'reopened', generation }).next;
        sent = false;
      }
      const transition = stepErrorFollowUp(state, {
        type: 'eligible',
        run,
        changed: entry.updates?.some((update) => update.changeType === 'error') ?? false,
        eligible: sent && !entry.token.startsWith('U'),
      });
      state = transition.next;
      expect(transition.claim, name).toBe(
        entry.alerts?.some((alert) => alert.kind === 'error') ?? false,
      );
    }
  }
});

it('replays captured reminder cadence and duplicate accepted outcomes', () => {
  for (const [name, interval] of [
    ['reminder cadence', 2],
    ['duplicate reminder outcomes', 1],
  ] as const) {
    let state: Reminder = {
      state: ReminderState.Unscheduled,
      run: null,
      count: 0,
      generation: null,
    };
    let run = 0;
    for (const entry of capturedLifecycle(name)) {
      for (const outcome of entry.outcomes ?? []) {
        if (outcome.kind === 'down')
          state = { ...state, state: ReminderState.Scheduled, run: outcome.run };
        if (outcome.kind === 'reminder')
          state = stepReminder(state, {
            type: outcome.delivered ? 'delivered' : 'refused',
            generation: outcome.reopenedAt,
          }).next;
      }
      if (!entry.now) continue;
      const transition = stepReminder(state, {
        type: 'eligible',
        run: ++run,
        interval,
        eligible: run > 1,
      });
      const alert = entry.alerts?.find((alert) => alert.kind === 'reminder');
      expect(transition.claim, name).toBe(Boolean(alert));
      if (alert) expect(state.count + 1).toBe(alert.reminder);
      state = transition.next;
    }
  }
});

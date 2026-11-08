import { expect, it } from 'vite-plus/test';
import { MembershipState, stepMembership } from '../../src/hub/subscriber-membership';

it('expires membership at the confirmation boundary without mutating the pending state', () => {
  const pending = { state: MembershipState.Pending, createdAt: 100 } as const;
  expect(stepMembership(pending, { type: 'confirm', now: 86499 })).toEqual({
    state: MembershipState.Confirmed,
    confirmedAt: 86499,
  });
  expect(stepMembership(pending, { type: 'confirm', now: 86500 })).toEqual({
    state: MembershipState.Absent,
  });
  expect(pending).toEqual({ state: MembershipState.Pending, createdAt: 100 });
});

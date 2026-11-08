export const PENDING_SECONDS = 24 * 60 * 60;

export enum MembershipState {
  Absent = 'absent',
  Pending = 'pending',
  Confirmed = 'confirmed',
}

export type Membership =
  | { state: MembershipState.Absent }
  | { state: MembershipState.Pending; createdAt: number }
  | { state: MembershipState.Confirmed; confirmedAt: number };

type MembershipEvent = { type: 'signup'; now: number } | { type: 'confirm'; now: number };

export function stepMembership(current: Membership, event: MembershipEvent): Membership {
  switch (event.type) {
    case 'signup':
      return current.state === MembershipState.Absent
        ? { state: MembershipState.Pending, createdAt: event.now }
        : current;
    case 'confirm':
      if (current.state !== MembershipState.Pending) return current;
      return event.now >= current.createdAt + PENDING_SECONDS
        ? { state: MembershipState.Absent }
        : { state: MembershipState.Confirmed, confirmedAt: event.now };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

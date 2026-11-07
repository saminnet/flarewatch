import { ALERT_CLAIM_SECONDS } from './down-alert-lifecycle';

export enum RecoveryState {
  Absent,
  Queued,
  Claimed,
}

export type Recovery =
  | { state: RecoveryState.Absent }
  | { state: RecoveryState.Queued; incident: number }
  | { state: RecoveryState.Claimed; incident: number; run: number; at: number };

export type RecoveryEvent =
  | { type: 'eligible'; now: number; run: number }
  | { type: 'deferred' | 'attempted'; incident: number; run: number }
  | { type: 'cancelled' };

export function stepRecovery(current: Recovery, event: RecoveryEvent) {
  switch (event.type) {
    case 'cancelled':
      return {
        next: { state: RecoveryState.Absent } as const,
        effect: current.state === RecoveryState.Absent ? ('none' as const) : ('delete' as const),
      };
    case 'eligible':
      if (
        current.state === RecoveryState.Absent ||
        (current.state === RecoveryState.Claimed && event.now - current.at < ALERT_CLAIM_SECONDS)
      )
        return { next: current, effect: 'none' as const };
      return {
        next: {
          state: RecoveryState.Claimed,
          incident: current.incident,
          at: event.now,
          run: event.run,
        } as const,
        effect: 'claim' as const,
      };
    case 'deferred':
    case 'attempted':
      if (
        current.state !== RecoveryState.Claimed ||
        current.incident !== event.incident ||
        current.run !== event.run
      )
        return { next: current, effect: 'none' as const };
      return event.type === 'deferred'
        ? {
            next: { state: RecoveryState.Queued, incident: current.incident } as const,
            effect: 'release' as const,
          }
        : { next: { state: RecoveryState.Absent } as const, effect: 'delete' as const };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/** Error-change alerts per incident, so a target whose error keeps changing cannot spam. */
export const MAX_ERROR_ALERTS = 5;

export enum ErrorFollowUpState {
  Idle,
  Owed,
}

export type ErrorFollowUp = {
  state: ErrorFollowUpState;
  count: number;
  run: number | null;
  generation: number | null;
};

export type ErrorFollowUpEvent =
  | { type: 'eligible'; run: number; eligible: boolean; changed: boolean }
  | { type: 'delivered' | 'refused' | 'deferred'; run: number; generation: number | null }
  | { type: 'reopened'; generation: number };

export function stepErrorFollowUp(current: ErrorFollowUp, event: ErrorFollowUpEvent) {
  switch (event.type) {
    case 'reopened':
      return {
        next: {
          ...current,
          state: ErrorFollowUpState.Idle,
          count: 0,
          generation: event.generation,
        },
        claim: false,
      };
    case 'eligible':
      if (
        !event.eligible ||
        (!event.changed && current.state !== ErrorFollowUpState.Owed) ||
        current.count >= MAX_ERROR_ALERTS
      )
        return { next: current, claim: false };
      return {
        next: {
          ...current,
          state: ErrorFollowUpState.Idle,
          count: current.count + 1,
          run: event.run,
        },
        claim: true,
      };
    case 'delivered':
      return { next: current, claim: false };
    case 'deferred':
    case 'refused':
      if (current.generation !== event.generation || current.count === 0)
        return { next: current, claim: false };
      return {
        next: {
          ...current,
          count: current.count - 1,
          state:
            event.type === 'deferred' && current.run === event.run
              ? ErrorFollowUpState.Owed
              : current.state,
        },
        claim: false,
      };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

export enum ReminderState {
  Unscheduled,
  Scheduled,
}

export type Reminder =
  | { state: ReminderState.Unscheduled; run: null; count: number; generation: number | null }
  | { state: ReminderState.Scheduled; run: number; count: number; generation: number | null };

export type ReminderEvent =
  | { type: 'eligible'; run: number; interval: number | undefined; eligible: boolean }
  | { type: 'delivered' | 'refused' | 'deferred'; generation: number | null }
  | { type: 'reopened'; generation: number };

export function stepReminder(current: Reminder, event: ReminderEvent) {
  switch (event.type) {
    case 'reopened':
      return { next: { ...current, count: 0, generation: event.generation }, claim: false };
    case 'eligible':
      if (
        !event.eligible ||
        event.interval === undefined ||
        event.run - (current.run ?? 0) < event.interval
      )
        return { next: current, claim: false };
      return {
        next: { ...current, state: ReminderState.Scheduled, run: event.run } as const,
        claim: true,
      };
    case 'delivered':
      return {
        next:
          event.generation === current.generation
            ? { ...current, count: current.count + 1 }
            : current,
        claim: false,
      };
    case 'deferred':
    case 'refused':
      return { next: current, claim: false };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

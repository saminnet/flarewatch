export enum FailureStreakState {
  Clear,
  Counting,
}

export type FailureStreak =
  | { state: FailureStreakState.Clear }
  | { state: FailureStreakState.Counting; count: number; first: number };

export type FailureStreakEvent = {
  type: 'passed' | 'failed';
  now: number;
  heartbeat: boolean;
  hasOpenIncident: boolean;
  threshold: number;
};

export function stepFailureStreak(streak: FailureStreak, event: FailureStreakEvent) {
  if (event.heartbeat) return { next: streak, write: false, apply: true, first: event.now };
  switch (event.type) {
    case 'passed':
      return {
        next: { state: FailureStreakState.Clear } as const,
        write: streak.state === FailureStreakState.Counting,
        apply: true,
        first: event.now,
      };
    case 'failed': {
      if (event.hasOpenIncident || event.threshold <= 1) {
        return { next: streak, write: false, apply: true, first: event.now };
      }
      const count = streak.state === FailureStreakState.Counting ? streak.count + 1 : 1;
      const first = streak.state === FailureStreakState.Counting ? streak.first : event.now;
      return {
        next: { state: FailureStreakState.Counting, count, first } as const,
        write: true,
        apply: count >= event.threshold,
        first,
      };
    }
    default: {
      const unreachable: never = event.type;
      return unreachable;
    }
  }
}

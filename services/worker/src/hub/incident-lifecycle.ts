/** A failure this soon after recovering reopens the incident, so a flapping target adds no rows. */
export const FLAP_SECONDS = 15 * 60;

export enum IncidentState {
  Absent,
  Open,
  ReopenedDown,
  RecoveryHold,
  Closed,
}

export type IncidentLifecycle =
  | { state: IncidentState.Absent }
  | { state: IncidentState.Open }
  | { state: IncidentState.ReopenedDown; generation: number; relapse: number | null }
  | {
      state: IncidentState.RecoveryHold;
      generation: number;
      relapse: number | null;
      upSince: number;
    }
  | { state: IncidentState.Closed; end: number };

export type IncidentEvent =
  | { type: 'passed'; now: number; legacyCertificate: boolean }
  | { type: 'failed'; now: number; changed: boolean };

type IncidentEffect = 'none' | 'insert' | 'reopen' | 'close' | 'hold' | 'relapse' | 'segment';

interface IncidentTransition {
  next: IncidentLifecycle;
  effect: IncidentEffect;
  end?: number;
}

export function stepIncident(current: IncidentLifecycle, event: IncidentEvent): IncidentTransition {
  const state = current.state;
  switch (event.type) {
    case 'failed':
      if (
        state === IncidentState.Absent ||
        (state === IncidentState.Closed && event.now - current.end > FLAP_SECONDS)
      )
        return { next: { state: IncidentState.Open }, effect: 'insert' };
      if (state === IncidentState.Closed)
        return {
          next: { state: IncidentState.ReopenedDown, generation: event.now, relapse: null },
          effect: 'reopen',
        };
      if (state === IncidentState.RecoveryHold)
        return {
          next: {
            state: IncidentState.ReopenedDown,
            generation: current.generation,
            relapse: event.now,
          },
          effect: 'relapse',
        };
      return { next: current, effect: event.changed ? 'segment' : 'none' };
    case 'passed':
      if (state === IncidentState.Absent || state === IncidentState.Closed)
        return { next: current, effect: 'none' };
      if (state !== IncidentState.Open && !event.legacyCertificate) {
        if (state === IncidentState.ReopenedDown)
          return {
            next: { ...current, state: IncidentState.RecoveryHold, upSince: event.now },
            effect: 'hold',
          };
        if (event.now - current.upSince < FLAP_SECONDS) return { next: current, effect: 'none' };
        return {
          next: {
            state: IncidentState.Closed,
            end: current.upSince,
          },
          effect: 'close',
          end: current.upSince,
        };
      }
      return {
        next: {
          state: IncidentState.Closed,
          end: event.now,
        },
        effect: 'close',
        end: event.now,
      };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

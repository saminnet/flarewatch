/** Failed deliveries of one down alert before the hub stops trying. */
export const MAX_ALERT_ATTEMPTS = 10;
/**
 * How long a run's claim on a down alert holds before another run may send it.
 * Longer than a cron run can last (15 minutes), so the run that made it is gone.
 */
export const ALERT_CLAIM_SECONDS = 20 * 60;

/**
 * Whether a webhook or subscriber outbox accepted the incident's down alert: 'pending', 'sending'
 * (claimed by a run), 'sent', 'failed' (gave up) or 'silent' (never alert).
 */
export enum DownAlertState {
  Pending = 'pending',
  Sending = 'sending',
  Sent = 'sent',
  Failed = 'failed',
  Silent = 'silent',
}

export type DownAlert = {
  state: DownAlertState;
  attempts: number;
  claimedAt: number | null;
  run: number | null;
};

export type DownAlertEvent =
  | { type: 'eligible'; now: number; run: number }
  | { type: 'delivered' | 'refused' | 'deferred'; run: number }
  | { type: 'reopened' };

export function stepDownAlert(current: DownAlert, event: DownAlertEvent) {
  switch (event.type) {
    case 'reopened':
      return {
        next:
          current.state === DownAlertState.Pending || current.state === DownAlertState.Sending
            ? current
            : { ...current, state: DownAlertState.Pending, attempts: 0 },
        claim: false,
      };
    case 'eligible': {
      const due =
        current.state === DownAlertState.Pending ||
        (current.state === DownAlertState.Sending &&
          event.now - (current.claimedAt ?? 0) >= ALERT_CLAIM_SECONDS);
      if (!due) return { next: current, claim: false };
      // A takeover cannot count an attempt because the abandoned sender's outcome is unknown.
      return {
        next: { ...current, state: DownAlertState.Sending, claimedAt: event.now, run: event.run },
        claim: true,
      };
    }
    case 'delivered':
    case 'deferred':
    case 'refused': {
      if (current.state !== DownAlertState.Sending || current.run !== event.run)
        return { next: current, claim: false };
      if (event.type === 'delivered')
        return { next: { ...current, state: DownAlertState.Sent }, claim: false };
      if (event.type === 'deferred')
        return { next: { ...current, state: DownAlertState.Pending }, claim: false };
      const attempts = current.attempts + 1;
      return {
        next: {
          ...current,
          attempts,
          state: attempts >= MAX_ALERT_ATTEMPTS ? DownAlertState.Failed : DownAlertState.Pending,
        },
        claim: false,
      };
    }
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

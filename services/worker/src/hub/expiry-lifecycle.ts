export const EXPIRY_RETRY_RUNS = 60;

export enum ExpiryReceiptState {
  Absent,
  Recorded,
  RetryWaiting,
}

export type ExpiryReceipt =
  | { state: ExpiryReceiptState.Absent }
  | { state: ExpiryReceiptState.Recorded; run: number }
  | { state: ExpiryReceiptState.RetryWaiting; run: number; retryRun: number };

export type ExpiryReceiptEvent = { type: 'delivered' | 'refused' | 'deferred'; run: number };

export function stepExpiryReceipt(current: ExpiryReceipt, event: ExpiryReceiptEvent) {
  const keep = { next: current, effect: 'none' as const };
  if (current.state === ExpiryReceiptState.Absent || current.run !== event.run) return keep;
  switch (event.type) {
    case 'deferred':
      return { next: { state: ExpiryReceiptState.Absent } as const, effect: 'delete' as const };
    case 'refused':
      return current.state === ExpiryReceiptState.Recorded
        ? {
            next: {
              state: ExpiryReceiptState.RetryWaiting,
              run: current.run,
              retryRun: event.run + EXPIRY_RETRY_RUNS,
            } as const,
            effect: 'wait' as const,
          }
        : keep;
    case 'delivered':
      return keep;
    default: {
      const unreachable: never = event.type;
      return unreachable;
    }
  }
}

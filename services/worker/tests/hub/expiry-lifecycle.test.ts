import { expect, it } from 'vite-plus/test';
import {
  ExpiryReceiptState,
  stepExpiryReceipt,
  type ExpiryReceipt,
} from '../../src/hub/expiry-lifecycle';
import { capturedLifecycle } from '../helpers/captured-lifecycle';

it('replays captured expiry acceptance, date changes, deferral and stored warning', () => {
  for (const name of ['expiry acceptance', 'expiry deferral and stored warning']) {
    const receipts = new Map<number, ExpiryReceipt>();
    for (const entry of capturedLifecycle(name)) {
      for (const alert of entry.alerts ?? []) {
        if (alert.kind === 'expiry')
          receipts.set(alert.run, { state: ExpiryReceiptState.Recorded, run: alert.run });
      }
      for (const outcome of entry.outcomes ?? []) {
        if (outcome.kind !== 'expiry') continue;
        const transition = stepExpiryReceipt(receipts.get(outcome.run)!, {
          type: outcome.deferred ? 'deferred' : 'delivered',
          run: outcome.run,
        });
        expect(transition.effect).toBe(outcome.deferred ? 'delete' : 'none');
        expect(transition.next.state).toBe(
          outcome.deferred ? ExpiryReceiptState.Absent : ExpiryReceiptState.Recorded,
        );
        receipts.set(outcome.run, transition.next);
      }
    }
  }
});

it('replays refused receipts, stale owners and accepted retries', () => {
  const cases: readonly [
    ExpiryReceipt,
    'refused' | 'delivered' | 'deferred',
    number,
    ExpiryReceipt,
    string,
  ][] = [
    [
      { state: ExpiryReceiptState.Recorded, run: 1 },
      'refused',
      1,
      { state: ExpiryReceiptState.RetryWaiting, run: 1, retryRun: 61 },
      'wait',
    ],
    [
      { state: ExpiryReceiptState.Recorded, run: 61 },
      'refused',
      1,
      { state: ExpiryReceiptState.Recorded, run: 61 },
      'none',
    ],
    [
      { state: ExpiryReceiptState.Recorded, run: 61 },
      'refused',
      61,
      { state: ExpiryReceiptState.RetryWaiting, run: 61, retryRun: 121 },
      'wait',
    ],
    [
      { state: ExpiryReceiptState.Recorded, run: 121 },
      'delivered',
      121,
      { state: ExpiryReceiptState.Recorded, run: 121 },
      'none',
    ],
    [
      { state: ExpiryReceiptState.Absent },
      'refused',
      121,
      { state: ExpiryReceiptState.Absent },
      'none',
    ],
  ];
  for (const [current, type, run, next, effect] of cases)
    expect(stepExpiryReceipt(current, { type, run })).toEqual({ next, effect });
});

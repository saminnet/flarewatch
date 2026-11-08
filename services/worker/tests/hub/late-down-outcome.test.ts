import { expect, it } from 'vite-plus/test';
import { createHub } from '../helpers/hub';
import { check, down, up } from '../helpers/check-records';

const T = 1_736_942_400;
const policy = { gracePeriodSeconds: 300, skipIds: [], skipErrorChanges: false };

it.each([false, true])(
  'fences a down outcome across reopen (delivered before reopen: %s)',
  (before) => {
    const { hub, db } = createHub();
    hub.record(T, [check('api', down())], policy, true);
    const claimed = hub.record(T + 300, [check('api', down())], policy, true).alerts;
    expect(claimed.map(({ kind }) => kind)).toEqual(['down']);
    const closed = hub.record(T + 360, [check('api', up())], policy, true);
    expect(closed.alerts).toEqual([]);
    expect(db.prepare('SELECT kind FROM subscriber_outbox ORDER BY id').all()).toEqual([
      { kind: 'down' },
      { kind: 'recovered' },
    ]);
    const outcome = claimed.map((alert) => ({ ...alert, delivered: true }));
    if (before) hub.confirmAlerts(outcome);
    hub.record(T + 420, [check('api', down())], policy, true);
    if (!before) hub.confirmAlerts(outcome);
    expect(db.prepare('SELECT alert FROM incidents').get()).toEqual({ alert: 'pending' });
    const eligible = hub.record(T + 720, [check('api', down())], policy, true);
    expect(eligible.alerts.map(({ kind }) => kind)).toEqual(['down']);
    expect(db.prepare('SELECT kind FROM subscriber_outbox ORDER BY id').all()).toEqual([
      { kind: 'down' },
      { kind: 'recovered' },
      { kind: 'down' },
    ]);
  },
);

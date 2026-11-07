import { expect, it, vi } from 'vite-plus/test';
import type { AlertPolicy } from '../../src/hub/alerts';
import { check, down, up } from '../helpers/check-records';
import { createHub } from '../helpers/hub';

const T0 = Date.parse('2026-11-01T12:00:00Z') / 1000;
const policy: AlertPolicy = { gracePeriodSeconds: 0, skipIds: [], skipErrorChanges: false };

function setup() {
  const { hub } = createHub();
  const run = (offset: number, ok = false) => {
    const record = check('api', ok ? up() : down());
    record.monitor.reminderEveryChecks = 1;
    return hub.record(T0 + offset, [record], policy).alerts;
  };
  const acknowledge = (offset: number, by: string) => {
    vi.spyOn(Date, 'now').mockReturnValue((T0 + offset) * 1000);
    return hub.ackIncident('api', by);
  };
  const history = () => hub.view().monitors.api?.incidents;
  const deliver = (alerts: ReturnType<typeof run>) =>
    hub.confirmAlerts(alerts.map((alert) => ({ ...alert, delivered: true })));
  deliver(run(0));
  expect(acknowledge(30, 'Pat')).toBe(true);
  return { hub, run, acknowledge, history, deliver };
}

it('clears both acknowledgement columns on reopen through the hub', () => {
  const { run, history } = setup();
  run(60, true);
  run(120);
  expect(history()).toEqual([{ start: [T0], error: ['Unavailable'] }]);
});

it('keeps both acknowledgement columns on a relapse inside the recovery hold', () => {
  const { run, acknowledge, history, deliver } = setup();
  deliver(run(60, true));
  deliver(run(120));
  expect(acknowledge(150, 'Lee')).toBe(true);
  run(180, true);
  run(240);
  expect(history()).toEqual([
    { start: [T0], error: ['Unavailable'], acked_at: T0 + 150, acked_by: 'Lee' },
  ]);
});

it('stops reminders while acknowledged and starts them again after a reopen', () => {
  const { hub, run, deliver } = setup();
  expect(run(60)).toEqual([]);
  expect(run(120)).toEqual([]);
  const recovery = run(180, true);
  expect(recovery).toMatchObject([{ kind: 'recovered', ackedBy: 'Pat' }]);
  hub.confirmAlerts(recovery.map((alert) => ({ ...alert, delivered: false, deferred: true })));
  const reopened = run(240);
  expect(reopened).toMatchObject([{ kind: 'down' }]);
  deliver(reopened);
  expect(run(300)).toMatchObject([{ kind: 'reminder', reminder: 1 }]);
  expect(run(360).some(({ kind }) => kind === 'recovered')).toBe(false);
});

it('accepts a second acknowledgement after a reopen and records the new person', () => {
  const { run, acknowledge, history } = setup();
  run(60, true);
  run(120);
  expect(acknowledge(150, 'Lee')).toBe(true);
  expect(history()).toEqual([
    { start: [T0], error: ['Unavailable'], acked_at: T0 + 150, acked_by: 'Lee' },
  ]);
});

it('keeps the acknowledgement in history when the closed incident does not reopen', () => {
  const { run, history } = setup();
  run(60, true);
  run(60 + 16 * 60, true);
  expect(history()).toEqual([
    { start: [T0], error: ['Unavailable'], end: T0 + 60, acked_at: T0 + 30, acked_by: 'Pat' },
  ]);
});

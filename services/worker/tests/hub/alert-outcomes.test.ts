import { expect, it } from 'vite-plus/test';
import { createHub } from '../helpers/hub';
import type { Alert } from '../../src/hub/alerts';

function setup() {
  const { hub, db } = createHub();
  const monitor = {
    id: 'api',
    name: 'API',
    method: 'GET' as const,
    target: 'https://example.com',
    reminderEveryChecks: 1,
  };
  const policy = { gracePeriodSeconds: 0, skipIds: [], skipErrorChanges: false };
  const record = (now: number, error?: string, expiryDate?: number) =>
    hub.record(
      now,
      [
        {
          monitor,
          check: {
            location: 'HEL',
            result:
              error === undefined
                ? {
                    ok: true,
                    latency: 1,
                    ...(expiryDate === undefined
                      ? {}
                      : { warning: { text: 'Expires soon', expiryDate } }),
                  }
                : { ok: false, error },
          },
        },
      ],
      policy,
    ).alerts;
  const changes = () => Number(db.prepare('SELECT total_changes() AS n').get()!.n);
  const confirm = (alerts: Alert[], delivered = false, deferred = false) => {
    const before = changes();
    hub.confirmAlerts(alerts.map((alert) => ({ ...alert, delivered, deferred })));
    return changes() - before;
  };
  return { record, confirm };
}

it('writes nothing for stale down owners and writes one row for the current owner', () => {
  const { record, confirm } = setup();
  const old = record(1000, 'A');
  const current = record(2200, 'A');
  expect(current).toMatchObject([{ kind: 'down' }]);
  expect(confirm(old)).toBe(0);
  expect(confirm(old, true)).toBe(0);
  expect(confirm(old, false, true)).toBe(0);
  expect(confirm(current, true)).toBe(1);
  expect(confirm(current, true)).toBe(0);
});

it('writes nothing for accepted errors, refused or deferred reminders and old generations', () => {
  const { record, confirm } = setup();
  confirm(record(1000, 'A'), true);
  const error = record(1060, 'B');
  expect(error).toMatchObject([{ kind: 'error' }]);
  expect(confirm(error, true, true)).toBe(0);
  const reminder = record(1120, 'B');
  expect(reminder).toMatchObject([{ kind: 'reminder' }]);
  expect(confirm(reminder)).toBe(0);
  expect(confirm(reminder, false, true)).toBe(0);
  record(1180);
  record(1240, 'B');
  expect(confirm(error)).toBe(0);
  expect(confirm(reminder, true)).toBe(0);
});

it('uses the stored recovery owner and writes nothing after its claim is released', () => {
  const { record, confirm } = setup();
  confirm(record(1000, 'A'), true);
  const old = record(1060);
  const current = record(2260);
  expect(current).toMatchObject([{ kind: 'recovered' }]);
  expect(confirm(old, true)).toBe(0);
  expect(confirm(old, false, true)).toBe(0);
  expect(confirm(current, false, true)).toBe(1);
  expect(confirm(current, true)).toBe(0);
});

it('writes nothing for delivered, repeated or absent expiry receipts', () => {
  const { record, confirm } = setup();
  const warning = record(1000, undefined, 2000000);
  expect(warning).toMatchObject([{ kind: 'expiry' }]);
  expect(confirm(warning, true)).toBe(0);
  expect(confirm(warning)).toBe(1);
  expect(confirm(warning)).toBe(0);
  expect(confirm(warning, false, true)).toBe(1);
  expect(confirm(warning)).toBe(0);
  expect(confirm(warning, false, true)).toBe(0);
});

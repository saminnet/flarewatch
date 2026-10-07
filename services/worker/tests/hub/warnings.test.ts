import { expect, it } from 'vite-plus/test';
import type { CheckResult, PullMonitor } from '@flarewatch/shared';
import { createHub } from '../helpers/hub';

it('alerts again for a date past ninety days while a retained claim suppresses it', () => {
  const { hub } = createHub();
  const policy = { gracePeriodSeconds: 0, skipIds: [], skipErrorChanges: false };
  const monitor: PullMonitor = {
    id: "api'; --",
    name: 'API',
    method: 'GET',
    target: 'https://example.com',
  };
  const DAY = 24 * 60 * 60;
  const warning = (expiryDate: number) => [
    {
      monitor,
      check: {
        location: 'HEL',
        result: { ok: true as const, latency: 1, warning: { text: 'Expiry', expiryDate } },
      },
    },
  ];
  const kinds = (alerts: { kind: string }[]) => alerts.map(({ kind }) => kind);

  const date = 21 * DAY;
  const first = hub.record(DAY, warning(date), policy).alerts;
  expect(kinds(first)).toEqual(['expiry']);
  hub.confirmAlerts(first.map((alert) => ({ ...alert, delivered: true })));
  expect(hub.record(DAY + 60, warning(date), policy).alerts).toEqual([]);

  expect(hub.record(date + 90 * DAY, warning(date), policy).alerts).toEqual([]);
  expect(kinds(hub.record(date + 90 * DAY + 1, warning(date), policy).alerts)).toEqual(['expiry']);
});

it('closes old certificate downtime, persists a warning and alerts once per expiry date after maintenance', () => {
  const { hub } = createHub();
  const monitor: PullMonitor = {
    id: 'api',
    name: 'API',
    method: 'GET',
    target: 'https://example.com',
    sslCheckEnabled: true,
    sslCheckDaysBeforeExpiry: 14,
  };
  const policy = { gracePeriodSeconds: 0, skipIds: [], skipErrorChanges: false };
  const record = (now: number, result: CheckResult) =>
    hub.record(now, [{ monitor, check: { location: 'HEL', result } }], policy);
  record(1000, { ok: false, error: 'Certificate expires in 14 days (threshold: 14)' });
  hub.putMaintenance({
    id: 'm',
    body: 'Work',
    monitors: ['api'],
    start: 1000000,
    end: 1120000,
    createdAt: 0,
    updatedAt: 0,
  });
  const near = (expiryDate: number): CheckResult => ({
    ok: true,
    latency: 1,
    ssl: { expiryDate, daysUntilExpiry: 14 },
  });
  expect(record(1060, near(2000000)).alerts.map(({ kind }) => kind)).toEqual([]);
  expect(hub.view().monitors.api).toMatchObject({
    status: 'degraded',
    warning: 'Certificate expires on 1970-01-24 (14 days remaining)',
    incidents: [{ start: [1000], end: 1060 }],
  });
  const claimed = record(1180, near(2000000)).alerts;
  expect(claimed.map(({ kind }) => kind)).toEqual(['expiry']);
  hub.confirmAlerts(claimed.map((alert) => ({ ...alert, delivered: false })));
  expect(record(1240, near(2000000)).alerts).toEqual([]);
  record(1300, { ok: true, latency: 1, ssl: { expiryDate: 3000000, daysUntilExpiry: 100 } });
  expect(hub.view().monitors.api?.warning).toBeUndefined();
  expect(record(1360, near(3000000)).alerts.map(({ kind }) => kind)).toEqual(['expiry']);
  expect(record(1420, near(2000000)).alerts).toEqual([]);
});

it.each(['Certificate', 'SSL certificate'])(
  'closes a flapping incident caused by the old %s threshold on upgrade',
  (prefix) => {
    const { hub } = createHub();
    const monitor: PullMonitor = {
      id: 'api',
      name: 'API',
      method: 'GET',
      target: 'https://example.com',
      sslCheckEnabled: true,
    };
    const record = (now: number, result: CheckResult) =>
      hub.record(now, [{ monitor, check: { location: 'HEL', result } }]);
    const down: CheckResult = { ok: false, error: `${prefix} expires in 14 days (threshold: 30)` };
    record(1000, down);
    record(1060, { ok: true, latency: 1 });
    record(1120, down);
    record(1180, { ok: true, latency: 1, ssl: { expiryDate: 2000000, daysUntilExpiry: 14 } });
    expect(hub.view().monitors.api?.status).toBe('degraded');
    expect(hub.view().monitors.api?.incidents).toEqual([
      { start: [1000], error: [down.error], end: 1180 },
    ]);
  },
);

it('releases only the matching deferred expiry claim and alerts a stored warning after a skipped maintenance run', () => {
  const { hub } = createHub();
  const monitor: PullMonitor = {
    id: 'api',
    name: 'API',
    method: 'GET',
    target: 'https://example.com',
    sslCheckEnabled: true,
  };
  const policy = { gracePeriodSeconds: 0, skipIds: [], skipErrorChanges: false };
  const entry = {
    monitor,
    check: {
      location: 'HEL',
      result: { ok: true as const, latency: 1, ssl: { expiryDate: 2000000, daysUntilExpiry: 14 } },
    },
  };
  hub.putMaintenance({
    id: 'm',
    body: 'Work',
    start: 1000000,
    end: 1060000,
    createdAt: 0,
    updatedAt: 0,
  });
  expect(hub.record(1000, [entry], policy).alerts).toEqual([]);
  const first = hub.record(1120, [{ monitor }], policy).alerts;
  expect(first.map(({ kind }) => kind)).toEqual(['expiry']);
  hub.confirmAlerts(first.map((alert) => ({ ...alert, delivered: false, deferred: true })));
  const second = hub.record(1180, [{ monitor }], policy).alerts;
  expect(second).toHaveLength(1);
  hub.confirmAlerts(first.map((alert) => ({ ...alert, delivered: false, deferred: true })));
  expect(hub.record(1240, [{ monitor }], policy).alerts).toEqual([]);
});

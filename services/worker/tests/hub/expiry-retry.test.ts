import { expect, it } from 'vite-plus/test';
import type { Alert } from '../../src/hub/alerts';
import { createHub } from '../helpers/hub';
import { rewindStatements } from '../helpers/schema-rewind';

function setup() {
  const { hub, db } = createHub();
  const monitor = { id: 'api', name: 'API', method: 'GET' as const, target: 'https://example.com' };
  const policy = { gracePeriodSeconds: 0, skipIds: [], skipErrorChanges: false };
  let now = 1000;
  const record = (date = 2000000) =>
    hub.record(
      now++,
      [
        {
          monitor,
          check: {
            location: 'HEL',
            result: { ok: true, latency: 1, warning: { text: 'Expires soon', expiryDate: date } },
          },
        },
      ],
      policy,
    ).alerts;
  const confirm = (alerts: Alert[], delivered = false, deferred = false) =>
    hub.confirmAlerts(alerts.map((alert) => ({ ...alert, delivered, deferred })));
  const advance = (count: number) => {
    for (let i = 0; i < count; i++) expect(record()).toEqual([]);
  };
  return { hub, db, monitor, policy, record, confirm, advance };
}

it('retries a refused warning at r+60 and each second refusal starts a new wait', () => {
  const { record, confirm, advance } = setup();
  const first = record();
  expect(first).toMatchObject([{ kind: 'expiry', run: 1 }]);
  confirm(first);
  expect(record()).toEqual([]);
  advance(58);
  const second = record();
  expect(second).toMatchObject([{ kind: 'expiry', run: 61 }]);
  confirm(second);
  advance(59);
  expect(record()).toMatchObject([{ kind: 'expiry', run: 121 }]);
});

it('ignores stale refusals and never retries a delivered receipt', () => {
  const { record, confirm, advance } = setup();
  const first = record();
  confirm(first);
  advance(59);
  const second = record();
  expect(second).toMatchObject([{ kind: 'expiry', run: 61 }]);
  confirm(first);
  expect(record()).toEqual([]);
  confirm(second, true);
  advance(120);
});

it('alerts a new expiry date immediately during a refused warning wait', () => {
  const { record, confirm } = setup();
  confirm(record());
  expect(record(3000000)).toMatchObject([{ kind: 'expiry', run: 2, expiryDate: 3000000 }]);
  expect(record()).toEqual([]);
});

it('preserves prior-step receipts when the database upgrades', () => {
  const { hub, db, record, confirm, monitor, policy } = setup();
  const delivered = record();
  confirm(delivered, true);
  record(3000000);
  const applied = db.prepare('SELECT MAX(id) AS id FROM _migrations').get()!.id;
  for (const sql of rewindStatements(Number(applied), 18)) db.exec(sql);
  const upgraded = createHub(db).hub;
  expect(
    db
      .prepare(
        'SELECT monitor_id,expiry_date,run,retry_run FROM expiry_alerts ORDER BY expiry_date',
      )
      .all(),
  ).toEqual([
    { monitor_id: 'api', expiry_date: 2000000, run: 1, retry_run: null },
    { monitor_id: 'api', expiry_date: 3000000, run: 2, retry_run: null },
  ]);
  expect(upgraded.record(1100, [{ monitor }], policy).alerts).toEqual([]);
  expect(hub.view().monitors.api?.warning).toBe('Expires soon');
});

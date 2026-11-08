import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';

const SOURCE = join(import.meta.dirname, '../../src');
const MIGRATIONS = 'hub/schema.ts';

const LIFECYCLE_TABLES = new Set([
  'incidents',
  'monitors',
  'pending_recoveries',
  'expiry_alerts',
  'subscriber_outbox',
  'subscribers',
]);

/**
 * Every file that writes each column. A new line here is a new way to change a lifecycle:
 * the write must take its value from the machine's step function. See docs/adr/0003.
 */
const WRITERS = {
  'expiry_alerts.expiry_date': ['hub/monitor-hub.ts'],
  'expiry_alerts.monitor_id': ['hub/monitor-hub.ts'],
  'expiry_alerts.retry_run': ['hub/alerts.ts', 'hub/monitor-hub.ts'],
  'expiry_alerts.run': ['hub/monitor-hub.ts'],
  'incidents.acked_at': ['hub/incidents.ts'],
  'incidents.acked_by': ['hub/incidents.ts'],
  'incidents.alert': ['hub/alerts.ts', 'hub/incidents.ts'],
  'incidents.alert_attempts': ['hub/alerts.ts', 'hub/incidents.ts'],
  'incidents.alert_claimed_at': ['hub/alerts.ts', 'hub/incidents.ts'],
  'incidents.alert_run': ['hub/alerts.ts', 'hub/incidents.ts'],
  'incidents.end_at': ['hub/incidents.ts'],
  'incidents.error_alerts': ['hub/alerts.ts', 'hub/incidents.ts'],
  'incidents.error_due': ['hub/alerts.ts', 'hub/incidents.ts'],
  'incidents.error_run': ['hub/alerts.ts'],
  'incidents.errors': ['hub/incidents.ts'],
  'incidents.monitor_id': ['hub/incidents.ts'],
  'incidents.relapsed_at': ['hub/incidents.ts'],
  'incidents.reminders': ['hub/alerts.ts', 'hub/incidents.ts'],
  'incidents.reopened_at': ['hub/incidents.ts'],
  'incidents.starts': ['hub/incidents.ts'],
  'incidents.subscriber_notified': ['hub/incidents.ts', 'hub/subscribers.ts'],
  'incidents.subscriber_recovered': ['hub/incidents.ts', 'hub/subscribers.ts'],
  'incidents.up_since': ['hub/incidents.ts'],
  'monitors.failure_count': ['hub/monitor-hub.ts'],
  'monitors.first_failure_at': ['hub/monitor-hub.ts'],
  'monitors.heartbeat': ['hub/monitor-hub.ts'],
  'monitors.id': ['hub/monitor-hub.ts'],
  'monitors.started_at': ['hub/monitor-hub.ts'],
  'monitors.warning': ['hub/monitor-hub.ts'],
  'pending_recoveries.acked_by': ['hub/alerts.ts'],
  'pending_recoveries.at': ['hub/alerts.ts'],
  'pending_recoveries.claimed_at': ['hub/alerts.ts'],
  'pending_recoveries.claimed_run': ['hub/alerts.ts'],
  'pending_recoveries.incident': ['hub/alerts.ts'],
  'pending_recoveries.monitor_id': ['hub/alerts.ts'],
  'pending_recoveries.reopened_at': ['hub/alerts.ts'],
  'pending_recoveries.start': ['hub/alerts.ts'],
  'subscriber_outbox.attempts': ['hub/subscribers.ts'],
  'subscriber_outbox.batch': ['hub/subscribers.ts'],
  'subscriber_outbox.batch_index': ['hub/subscribers.ts'],
  'subscriber_outbox.created_at': ['hub/subscribers.ts'],
  'subscriber_outbox.incident_id': ['hub/subscribers.ts'],
  'subscriber_outbox.kind': ['hub/subscribers.ts'],
  'subscriber_outbox.monitor_id': ['hub/subscribers.ts'],
  'subscriber_outbox.payload': ['hub/subscribers.ts'],
  'subscriber_outbox.sent_to': ['hub/subscribers.ts'],
  'subscribers.email': ['hub/subscribers.ts'],
  'subscribers.state': ['hub/subscribers.ts'],
  'subscribers.created_at': ['hub/subscribers.ts'],
  'subscribers.confirmed_at': ['hub/subscribers.ts'],
};

function writtenColumns(sql: string) {
  const write = /(?:UPDATE (\w+) SET|INSERT (?:OR \w+ )?INTO (\w+))([\s\S]*)/.exec(sql);
  if (!write) return [];
  const table = write[1] ?? write[2];
  const [changes = ''] = (write[3] ?? '').split(/\b(?:WHERE|RETURNING)\b/);
  const assigned = [...changes.matchAll(/(\w+) = /g)].map((match) => match[1]);
  const inserted = write[2] ? (/\(([^)]*)\)/.exec(changes)?.[1] ?? '').split(/,\s*/) : [];
  return [...inserted, ...assigned].map((column) => `${table}.${column}`);
}

function lifecycleWriters() {
  const writers = new Map<string, Set<string>>();
  const files = readdirSync(SOURCE, { recursive: true, encoding: 'utf8' }).filter(
    (file) => file.endsWith('.ts') && file !== MIGRATIONS,
  );
  for (const file of files) {
    const code = readFileSync(join(SOURCE, file), 'utf8').replace(/^\s*(?:\/\/|\/?\*).*$/gm, '');
    for (const [literal] of code.matchAll(/`[^`]*`|"[^"]*"|'[^']*'/g)) {
      for (const column of writtenColumns(literal)) {
        if (!LIFECYCLE_TABLES.has(column.split('.')[0] ?? '')) continue;
        writers.set(column, (writers.get(column) ?? new Set()).add(file));
      }
    }
  }
  return Object.fromEntries(
    [...writers].map(([column, owners]) => [column, [...owners].sort()] as const),
  );
}

describe('lifecycle columns', () => {
  it('are written only by the files that run their step functions', () => {
    expect(lifecycleWriters()).toEqual(WRITERS);
  });
});

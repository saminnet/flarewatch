import * as z from 'zod/mini';
import type { PageConfig } from '@flarewatch/shared';
import type { Env } from '../env';
import {
  cloudflareSender,
  resendSender,
  PermanentSubscriberError,
  subscriberMessageSchema,
} from '../notifications/subscriber-sender';
import { subscriberMail } from '../notifications/subscriber-mail';
import { parseJson, setMeta } from './sql';
import type { Sql } from './sql';
import type { Alert } from './alerts';
import { isPublicMonitor, type Monitor } from '@flarewatch/shared';

import { readNotice, stepNotice, noticeColumns, type NoticeColumns } from './subscriber-notices';
import {
  readOutbox,
  stepOutbox,
  outboxColumns,
  OutboxStatus,
  type OutboxState,
  type OutboxColumns,
} from './subscriber-outbox';

export const PENDING_SECONDS = 24 * 60 * 60;

export class Subscribers {
  constructor(private readonly sql: Sql) {}

  purge(now: number): void {
    this.sql.exec(
      "DELETE FROM subscribers WHERE state = 'pending' AND created_at <= ?",
      now - PENDING_SECONDS,
    );
    this.sql.exec(
      "DELETE FROM subscriber_outbox WHERE kind = 'confirm' AND created_at <= ?",
      now - PENDING_SECONDS,
    );
  }

  subscribe(email: string, now: number, max: number): boolean {
    return this.sql.transaction(() => {
      this.purge(now);
      const [existing] = this.sql.exec('SELECT id FROM subscribers WHERE email = ?', email);
      if (existing) return false;
      const [count] = this.sql.exec<{ total: number }>('SELECT COUNT(*) AS total FROM subscribers');
      if ((count?.total ?? 0) >= max) return false;
      const [row] = this.sql.exec<{ id: number }>(
        "INSERT INTO subscribers (email, state, created_at) VALUES (?, 'pending', ?) RETURNING id",
        email,
        now,
      );
      this.sql.exec(
        "INSERT INTO subscriber_outbox (kind, payload, created_at) VALUES ('confirm', ?, ?)",
        JSON.stringify({ email, generation: String(row!.id) }),
        now,
      );
      return true;
    });
  }

  confirm(email: string, generation: string, now: number): boolean {
    return this.sql.transaction(() => {
      this.purge(now);
      return (
        this.sql.exec(
          "UPDATE subscribers SET state = 'confirmed', confirmed_at = COALESCE(confirmed_at, ?) WHERE email = ? AND id = ? RETURNING id",
          now,
          email,
          generation,
        ).length > 0
      );
    });
  }

  unsubscribe(email: string): void {
    this.sql.exec('DELETE FROM subscribers WHERE email = ?', email);
  }

  count(): number {
    return (
      this.sql.exec<{ total: number }>(
        "SELECT COUNT(*) AS total FROM subscribers WHERE state = 'confirmed'",
      )[0]?.total ?? 0
    );
  }

  list(after: number, at: number, limit: number): { id: number; email: string }[] {
    return this.sql.exec<{ id: number; email: string }>(
      "SELECT id, email FROM subscribers WHERE state = 'confirmed' AND id > ? AND confirmed_at <= ? ORDER BY id LIMIT ?",
      after,
      at,
      limit,
    );
  }

  enqueue(alert: Alert, monitors: Monitor[], now: number): boolean {
    if (alert.kind !== 'down' && alert.kind !== 'recovered') return false;
    const monitor = monitors.find(({ id }) => id === alert.monitorId);
    if (!monitor || !isPublicMonitor(monitor)) return false;
    const [row] = this.sql.exec<NoticeColumns>(
      'SELECT subscriber_notified, subscriber_recovered FROM incidents WHERE id = ?',
      alert.incident,
    );
    if (!row) return false;
    const state = readNotice(row);
    const next = stepNotice(
      state,
      alert.kind === 'down' ? 'down notice sent' : 'recovery notice sent',
    );
    if (next === state) return false;
    const columns = noticeColumns(next);
    this.sql.exec(
      'UPDATE incidents SET subscriber_notified = ?, subscriber_recovered = ? WHERE id = ?',
      columns.subscriber_notified,
      columns.subscriber_recovered,
      alert.incident,
    );
    this.sql.exec(
      'INSERT INTO subscriber_outbox (kind, monitor_id, payload, created_at) VALUES (?, ?, ?, ?)',
      alert.kind,
      monitor.id,
      JSON.stringify({ name: monitor.name, start: alert.incidentStartTime, at: alert.at ?? now }),
      now,
    );
    return true;
  }
}

export type SubscriberSettings = NonNullable<PageConfig['subscribers']>;

export const subscriberAlarmSchema = z.object({
  subscribers: z.optional(
    z.object({
      from: z.string(),
      provider: z.exactOptional(z.enum(['resend', 'cloudflare'])),
      dailySendCap: z.exactOptional(z.number()),
      maxSubscribers: z.exactOptional(z.number()),
    }),
  ),
  visibility: z.optional(z.enum(['public', 'private'])),
  monitors: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      private: z.exactOptional(z.boolean()),
      dependsOn: z.exactOptional(z.array(z.string())),
    }),
  ),
});

type OutboxRow = OutboxColumns & {
  id: number;
  kind: string;
  monitor_id: string | null;
  payload: string;
  created_at: number;
};

const payloadSchema = z.object({
  email: z.optional(z.string()),
  generation: z.optional(z.string()),
  name: z.optional(z.string()),
  start: z.optional(z.number()),
  at: z.optional(z.number()),
});

export async function drainSubscribers(
  subscribers: Subscribers,
  sql: Sql,
  storage: DurableObjectStorage,
  settings: SubscriberSettings,
  monitors: Pick<Monitor, 'id' | 'private'>[],
  env: Env,
  clock: () => number,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const cloudflare = settings.provider === 'cloudflare';
  const sender = cloudflare
    ? env.SUBSCRIBER_EMAIL && cloudflareSender(env.SUBSCRIBER_EMAIL)
    : env.RESEND_API_KEY && resendSender(env.RESEND_API_KEY, fetcher);
  const startedAt = clock();
  await storage.setAlarm((startedAt + 3600) * 1000);
  subscribers.purge(startedAt);
  for (let request = 0; request < 10; request++) {
    const now = clock();
    const day = Math.floor(now / PENDING_SECONDS);
    const tomorrow = (day + 1) * PENDING_SECONDS;
    const [row] = sql.exec<OutboxRow>('SELECT * FROM subscriber_outbox ORDER BY id LIMIT 1');
    if (!row) {
      const [pending] = sql.exec<{ at: number | null }>(
        "SELECT MIN(created_at) AS at FROM subscribers WHERE state = 'pending'",
      );
      if (pending?.at !== null && pending?.at !== undefined)
        await storage.setAlarm((pending.at + PENDING_SECONDS) * 1000);
      else await storage.deleteAlarm();
      return;
    }
    if (!sender || !env.SUBSCRIBER_SECRET || !env.PUBLIC_ORIGIN) {
      await storage.setAlarm((now + 3600) * 1000);
      return;
    }
    let state = readOutbox(row);
    if (
      row.kind !== 'confirm' &&
      !monitors.some((monitor) => monitor.id === row.monitor_id && isPublicMonitor(monitor))
    ) {
      writeOutbox(sql, row.id, stepOutbox(state, { type: 'row finished' }));
      continue;
    }
    const payload = payloadSchema.parse(parseJson(row.payload));
    const [meta] = sql.exec<{ value: string }>(
      "SELECT value FROM meta WHERE key = 'subscriber_sends'",
    );
    const quota = quotaSchema.safeParse(parseJson(meta?.value ?? null)).data;
    const used = quota?.day === day ? quota.count : 0;
    const available = Math.max(0, (settings.dailySendCap ?? 90) - used);
    let batch = state.batch;
    // Resend forgets idempotency keys after 24 hours. Never replay an ambiguous older send.
    if (!cloudflare && batch && now - batch.preparedAt >= 23 * 3600) {
      finishBatch(sql, row, state);
      console.error('Expired ambiguous subscriber batch', {
        event: row.id,
        batch: state.batchIndex,
      });
      continue;
    }
    if (!batch) {
      if (available === 0) {
        await storage.setAlarm(tomorrow * 1000);
        return;
      }
      let recipients: { id: number; email: string }[];
      if (row.kind === 'confirm') {
        recipients = sql.exec<{ id: number; email: string }>(
          "SELECT id, email FROM subscribers WHERE email = ? AND id = ? AND state = 'pending'",
          payload.email ?? '',
          payload.generation ?? '',
        );
      } else {
        recipients = subscribers.list(
          state.sentTo,
          row.created_at,
          Math.min(sender.maxPerBatch, available),
        );
      }
      if (recipients.length === 0) {
        writeOutbox(sql, row.id, stepOutbox(state, { type: 'row finished' }));
        continue;
      }
      const messages = await Promise.all(
        recipients.map(({ email }) =>
          subscriberMail(settings.from, env.PUBLIC_ORIGIN!, env.SUBSCRIBER_SECRET!, email, {
            ...payload,
            kind: row.kind,
          }),
        ),
      );
      batch = {
        sent: 0,
        body: JSON.stringify(messages),
        lastId: recipients[recipients.length - 1]!.id,
        size: messages.length,
        preparedAt: now,
        day,
      };
      state = stepOutbox(state, { type: 'batch built', batch });
      saveBatch(sql, row.id, state, day, used);
    } else if (batch.day !== day) {
      if (available < batch.size - batch.sent) {
        await storage.setAlarm(tomorrow * 1000);
        return;
      }
      state = stepOutbox(state, { type: 'day changed', day });
      batch = state.batch!;
      saveBatch(sql, row.id, state, day, used);
    }
    // Arm the next attempt before network I/O, including a process death or exhausted platform retries.
    await storage.setAlarm((now + Math.min(3600, 30 * 2 ** Math.min(state.attempts, 7))) * 1000);
    try {
      const messages = z.array(subscriberMessageSchema).parse(parseJson(batch.body));
      const key = `subscribers/${row.id}/${state.batchIndex}`;
      if (cloudflare) {
        while (batch.sent < messages.length) {
          const sendNow = clock();
          if (Math.floor(sendNow / PENDING_SECONDS) !== batch.day) {
            await storage.setAlarm((sendNow + 30) * 1000);
            return;
          }
          await sender.send(messages.slice(batch.sent, batch.sent + 1), key);
          state = stepOutbox(state, { type: 'recipient sent' });
          batch = state.batch!;
          writeOutbox(sql, row.id, state);
        }
      } else await sender.send(messages, key);
      finishBatch(sql, row, state);
    } catch (error) {
      if (error instanceof PermanentSubscriberError) {
        writeOutbox(sql, row.id, stepOutbox(state, { type: 'row finished' }));
        console.error('Permanent subscriber send failure', { event: row.id, cause: String(error) });
        continue;
      }
      writeOutbox(sql, row.id, stepOutbox(state, { type: 'batch failed' }));
      console.error('Subscriber send failed', { event: row.id, cause: String(error) });
      return;
    }
  }
  await storage.setAlarm((clock() + 30) * 1000);
}

const quotaSchema = z.object({ day: z.number(), count: z.number() });

function saveBatch(sql: Sql, id: number, state: OutboxState, day: number, used: number): void {
  if (state.status !== OutboxStatus.Sending) return;
  const { batch } = state;
  sql.transaction(() => {
    setMeta(
      sql,
      'subscriber_sends',
      JSON.stringify({ day, count: used + batch.size - batch.sent }),
    );
    writeOutbox(sql, id, state);
  });
}

function writeOutbox(sql: Sql, id: number, state: OutboxState): void {
  if (state.status === OutboxStatus.Finished) {
    sql.exec('DELETE FROM subscriber_outbox WHERE id = ?', id);
    return;
  }
  const columns = outboxColumns(state);
  sql.exec(
    'UPDATE subscriber_outbox SET sent_to = ?, batch_index = ?, batch = ?, attempts = ? WHERE id = ?',
    columns.sent_to,
    columns.batch_index,
    columns.batch,
    columns.attempts,
    id,
  );
}

function finishBatch(sql: Sql, row: OutboxRow, state: OutboxState): void {
  writeOutbox(
    sql,
    row.id,
    stepOutbox(state, { type: row.kind === 'confirm' ? 'row finished' : 'batch sent' }),
  );
}

import { cloudflareSender } from '../src/notifications/subscriber-sender';
import { subscriberMail } from '../src/notifications/subscriber-mail';
import * as z from 'zod/mini';
import { describe, expect, it, vi } from 'vite-plus/test';
import { createHub } from './helpers/hub';
import { check, down, up } from './helpers/check-records';

const T = 1_736_942_400;
const policy = { gracePeriodSeconds: 0, skipIds: [], skipErrorChanges: false };

function outbox(db: ReturnType<typeof createHub>['db']) {
  return db.prepare('SELECT kind, payload FROM subscriber_outbox ORDER BY id').all();
}

describe('subscriber storage', () => {
  it('keeps signup idempotent and counts pending addresses against the cap', () => {
    const { hub, db } = createHub();
    expect(hub.subscribe('one@example.com', T, 2)).toBe(true);
    expect(hub.subscribe('one@example.com', T, 2)).toBe(false);
    expect(hub.subscribe('two@example.com', T, 2)).toBe(true);
    expect(hub.confirmSubscriber('one@example.com', '1', T + 1)).toBe(true);
    expect(hub.subscribe('three@example.com', T, 2)).toBe(false);
    expect(hub.subscriberCount()).toBe(1);
    expect(outbox(db)).toHaveLength(2);
  });

  it('expires pending addresses and their confirmations at 24 hours', () => {
    const { hub, db } = createHub();
    hub.subscribe('one@example.com', T, 1);
    expect(hub.confirmSubscriber('one@example.com', '1', T + 86400)).toBe(false);
    expect(outbox(db)).toEqual([]);
    expect(hub.subscribe('two@example.com', T + 86400, 1)).toBe(true);
    expect(hub.confirmSubscriber('two@example.com', '1', T + 86401)).toBe(false);
  });

  it('enqueues once despite webhook retries and queues recovery despite webhook failure', () => {
    const { hub, db } = createHub();
    const first = hub.record(T, [check('api', down())], policy, true);
    hub.confirmAlerts(first.alerts.map((alert) => ({ ...alert, delivered: false })));
    hub.record(T + 60, [check('api', down())], policy, true);
    const recovered = hub.record(T + 120, [check('api', up())], policy, true);
    expect(recovered.alerts).toEqual([]);
    expect(outbox(db).map(({ kind }) => kind)).toEqual(['down', 'recovered']);
  });

  it('excludes private monitors, private descendants and raw errors from the stored payload', () => {
    const { hub, db } = createHub();
    const root = check('api', down('private error'));
    const child = check('secret', down());
    child.monitor.private = true;
    child.monitor.dependsOn = ['api'];
    hub.record(T, [root, child], policy, true);
    expect(outbox(db)).toHaveLength(1);
    expect(JSON.stringify(outbox(db))).not.toContain('secret');
    expect(JSON.stringify(outbox(db))).not.toContain('private error');
  });
});

const mailEnv = {
  RESEND_API_KEY: 'test-key',
  SUBSCRIBER_SECRET: 'test-secret',
  PUBLIC_ORIGIN: 'https://status.example.com',
};
const settings = { from: 'status@example.com', dailySendCap: 200 };

function confirmed(db: ReturnType<typeof createHub>['db'], count: number) {
  for (let id = 1; id <= count; id++) {
    db.prepare(
      "INSERT INTO subscribers (email, state, created_at, confirmed_at) VALUES (?, 'confirmed', ?, ?)",
    ).run(`person${id}@example.com`, T - 10, T - 1);
  }
}

function captureMail(afterSend?: (index: number) => void) {
  const sent: {
    body: { to: string[]; text: string; html: string; headers: Record<string, string> }[];
    key: string | null;
  }[] = [];
  const network = vi.fn<typeof fetch>(async (_url, init) => {
    const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '');
    const messages = z
      .array(
        z.object({
          to: z.array(z.string()),
          text: z.string(),
          html: z.string(),
          headers: z.record(z.string(), z.string()),
        }),
      )
      .parse(body);
    sent.push({ body: messages, key: new Headers(init?.headers).get('Idempotency-Key') });
    afterSend?.(sent.length);
    return Response.json({ data: messages.map((_, index) => ({ id: `mail-${index}` })) });
  });
  vi.stubGlobal('fetch', network);
  return { sent, network };
}

describe('subscriber alarm drain', () => {
  it('persists only alarm fields and writes the settings row only when they change', () => {
    const { hub, db } = createHub();
    const records = [check('api', up())];
    records[0]!.monitor.private = true;
    records[0]!.monitor.dependsOn = ['db'];
    const page = { subscribers: { ...settings, maxSubscribers: 2 } };
    db.exec(`CREATE TABLE settings_writes (value TEXT);
      CREATE TRIGGER settings_insert AFTER INSERT ON meta WHEN NEW.key = 'subscriber_settings'
      BEGIN INSERT INTO settings_writes VALUES (NEW.value); END;
      CREATE TRIGGER settings_update AFTER UPDATE ON meta WHEN NEW.key = 'subscriber_settings'
      BEGIN INSERT INTO settings_writes VALUES (NEW.value); END;`);
    hub.record(T, records, policy, true, page);
    hub.record(T + 60, records, policy, true, page);
    expect(db.prepare('SELECT value FROM settings_writes').all()).toEqual([
      {
        value: JSON.stringify({
          subscribers: { from: 'status@example.com', dailySendCap: 200, maxSubscribers: 2 },
          monitors: [{ id: 'api', name: 'api', private: true, dependsOn: ['db'] }],
        }),
      },
    ]);
    hub.record(T + 120, records, policy, true, { subscribers: { ...settings, dailySendCap: 1 } });
    expect(db.prepare('SELECT COUNT(*) AS count FROM settings_writes').get()).toEqual({ count: 2 });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM meta WHERE key = 'subscriber_settings'").get(),
    ).toEqual({ count: 1 });
  });

  it('uses persisted alarm settings after restart', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T * 1000);
    const { hub, db } = createHub(undefined, mailEnv);
    confirmed(db, 3);
    hub.record(T, [check('api', down())], policy, true, {
      subscribers: { ...settings, dailySendCap: 2 },
    });
    const { sent } = captureMail();
    await createHub(db, mailEnv).hub.alarm();
    expect(sent.map(({ body }) => body.length)).toEqual([2]);
    vi.useRealTimers();
  });

  it('rearms delivery when settings become available on a healthy run', async () => {
    const { hub, storage } = createHub();
    hub.subscribe('one@example.com', T);
    await Promise.resolve();
    await storage.deleteAlarm();
    await hub.alarm();
    hub.record(T + 60, [check('api', up())], policy, true, { subscribers: settings });
    await Promise.resolve();
    expect(await storage.getAlarm()).toBe((T + 60) * 1000);
  });

  it.each(['missing', 'removed', 'private'] as const)(
    'leaves the outbox untouched when settings are %s',
    async (state) => {
      const { hub, db } = createHub(undefined, mailEnv);
      const records = [check('api', down())];
      hub.record(T, records, policy, true);
      if (state !== 'missing') {
        hub.record(T + 60, records, policy, true, { subscribers: settings });
        hub.record(
          T + 120,
          records,
          policy,
          false,
          state === 'removed' ? {} : { subscribers: settings, visibility: 'private' },
        );
      }
      const before = outbox(db);
      const { network } = captureMail();
      await hub.alarm();
      expect(network).not.toHaveBeenCalled();
      expect(outbox(db)).toEqual(before);
    },
  );

  it('rejects oversized settings without recording the run', () => {
    const { hub } = createHub();
    const record = check('api', up());
    record.monitor.name = 'x'.repeat(1_900_001);
    expect(() => hub.record(T, [record], policy, true, { subscribers: settings })).toThrow(
      'Subscriber alarm settings exceed the hub row limit',
    );
    expect(hub.view().lastUpdate).toBe(0);
  });

  it('sends batches of 100, persists progress and honours unsubscribe before the next batch', async () => {
    const { hub, db } = createHub(undefined, mailEnv);
    confirmed(db, 201);
    hub.record(T, [check('api', down())], policy, true);
    const { sent, network } = captureMail((batch) => {
      if (batch === 1) hub.unsubscribe('person101@example.com');
    });
    await hub.drainSubscriberOutbox(settings, [check('api', down()).monitor], T);
    expect(sent.map(({ body }) => body.length)).toEqual([100, 100]);
    expect(network.mock.calls[0]?.[1]?.redirect).toBe('manual');
    expect(sent.flatMap(({ body }) => body).flatMap(({ to }) => to)).not.toContain(
      'person101@example.com',
    );
    expect(sent.map(({ key }) => key)).toEqual([
      expect.stringMatching(/^subscribers\/[0-9a-f-]{36}\/1\/0$/),
      expect.stringMatching(/^subscribers\/[0-9a-f-]{36}\/1\/1$/),
    ]);
    await hub.drainSubscriberOutbox(settings, [check('api', down()).monitor], T + 1);
    expect(sent).toHaveLength(2);
  });

  it('stops at the daily cap and continues after UTC midnight', async () => {
    const { hub, db, storage } = createHub(undefined, mailEnv);
    confirmed(db, 3);
    hub.record(T, [check('api', down())], policy, true);
    const { sent } = captureMail();
    await hub.drainSubscriberOutbox(
      { ...settings, dailySendCap: 2 },
      [check('api', down()).monitor],
      T,
    );
    expect(sent.map(({ body }) => body.length)).toEqual([2]);
    const midnight = (Math.floor(T / 86400) + 1) * 86400;
    expect(await storage.getAlarm()).toBe(midnight * 1000);
    await hub.drainSubscriberOutbox(
      { ...settings, dailySendCap: 2 },
      [check('api', down()).monitor],
      midnight,
    );
    expect(sent.map(({ body }) => body.length)).toEqual([2, 1]);
  });

  it('replays the persisted batch after failure and restart without spending the quota twice', async () => {
    const { hub, db, storage } = createHub(undefined, mailEnv);
    confirmed(db, 2);
    hub.record(T, [check('api', down())], policy, true);
    const { sent, network } = captureMail();
    network.mockRejectedValueOnce(new Error('network interrupted'));
    await hub.drainSubscriberOutbox(
      { ...settings, dailySendCap: 2 },
      [check('api', down()).monitor],
      T,
    );
    expect(
      db.prepare('SELECT sent_to, batch_index, attempts FROM subscriber_outbox').get(),
    ).toEqual({ sent_to: 0, batch_index: 0, attempts: 1 });
    const failedRequest = network.mock.calls[0]?.[1];
    expect(await storage.getAlarm()).toBe((T + 30) * 1000);
    const restarted = createHub(db, mailEnv).hub;
    await restarted.drainSubscriberOutbox(
      { ...settings, dailySendCap: 2 },
      [check('api', down()).monitor],
      T + 30,
    );
    expect(
      db.prepare('SELECT sent_to, batch_index, attempts FROM subscriber_outbox').get(),
    ).toEqual({ sent_to: 2, batch_index: 1, attempts: 0 });
    expect(sent).toHaveLength(1);
    expect(network.mock.calls[1]?.[1]?.body).toBe(failedRequest?.body);
    expect(new Headers(network.mock.calls[1]?.[1]?.headers).get('Idempotency-Key')).toBe(
      new Headers(failedRequest?.headers).get('Idempotency-Key'),
    );
  });

  it('counts confirmations against the daily cap and purges them after expiry', async () => {
    const { hub, storage } = createHub(undefined, mailEnv);
    hub.subscribe('one@example.com', T);
    hub.subscribe('two@example.com', T);
    const { sent } = captureMail();
    await hub.drainSubscriberOutbox({ ...settings, dailySendCap: 1 }, [], T);
    expect(sent.map(({ body }) => body.length)).toEqual([1]);
    expect(sent[0]?.body[0]?.text).toContain('/subscribe/confirm?token=');
    expect(sent[0]?.body[0]?.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    await hub.drainSubscriberOutbox({ ...settings, dailySendCap: 1 }, [], T + 86400);
    expect(sent).toHaveLength(1);
    expect(await storage.getAlarm()).toBeNull();
  });

  it('sends incident mail ahead of confirmations queued before it', async () => {
    const { hub, db } = createHub(undefined, mailEnv);
    confirmed(db, 1);
    hub.subscribe('new@example.com', T);
    hub.record(T, [check('api', down())], policy, true);
    const { sent } = captureMail();
    await hub.drainSubscriberOutbox(settings, [check('api', down()).monitor], T);
    expect(sent.map(({ body }) => body[0]?.to[0])).toEqual([
      'person1@example.com',
      'new@example.com',
    ]);
  });

  it('keeps half the daily cap for incident mail during a burst of signups', async () => {
    const { hub, db } = createHub(undefined, mailEnv);
    for (let id = 1; id <= 6; id++) hub.subscribe(`new${id}@example.com`, T, 100);
    const monitor = check('api', down()).monitor;
    const { sent } = captureMail();
    await hub.drainSubscriberOutbox({ ...settings, dailySendCap: 4 }, [monitor], T);
    expect(sent).toHaveLength(2);

    confirmed(db, 2);
    hub.record(T + 60, [check('api', down())], policy, true);
    await hub.drainSubscriberOutbox({ ...settings, dailySendCap: 4 }, [monitor], T + 60);
    expect(sent.slice(2).flatMap(({ body }) => body.map(({ text }) => text))).toEqual([
      expect.stringContaining('api is down'),
      expect.stringContaining('api is down'),
    ]);
  });

  it('never sends a queued incident after the monitor becomes private', async () => {
    const { hub, db } = createHub(undefined, mailEnv);
    confirmed(db, 1);
    hub.record(T, [check('api', down())], policy, true);
    const { sent } = captureMail();
    await hub.drainSubscriberOutbox(
      settings,
      [{ ...check('api', down()).monitor, private: true }],
      T,
    );
    expect(sent).toEqual([]);
  });

  it('does not retry ambiguous batches after the provider forgets their idempotency key', async () => {
    const { hub, db } = createHub(undefined, mailEnv);
    confirmed(db, 1);
    hub.record(T, [check('api', down())], policy, true);
    const { network } = captureMail();
    network.mockRejectedValueOnce(new Error('connection lost'));
    await hub.drainSubscriberOutbox(settings, [check('api', down()).monitor], T);
    await hub.drainSubscriberOutbox(settings, [check('api', down()).monitor], T + 23 * 3600);
    expect(network).toHaveBeenCalledTimes(1);
  });
});

it('brings a new outbox entry forward instead of waiting for pending expiry', async () => {
  const { hub, storage } = createHub(undefined, mailEnv);
  captureMail();
  hub.subscribe('one@example.com', T);
  await hub.drainSubscriberOutbox(settings, [], T);
  expect(await storage.getAlarm()).toBe((T + 86400) * 1000);
  hub.subscribe('two@example.com', T + 10);
  await Promise.resolve();
  expect(await storage.getAlarm()).toBe((T + 10) * 1000);
});

it.each(['refused', 'invalid acknowledgement'])(
  'retries a batch after %s without losing its recipients',
  async (failure) => {
    const { hub, db } = createHub(undefined, mailEnv);
    confirmed(db, 1);
    hub.record(T, [check('api', down())], policy, true);
    const { network, sent } = captureMail();
    network.mockResolvedValueOnce(
      failure === 'refused'
        ? new Response('Rate limit', { status: 429 })
        : Response.json({ data: [] }),
    );
    await hub.drainSubscriberOutbox(
      { ...settings, dailySendCap: 1 },
      [check('api', down()).monitor],
      T,
    );
    await hub.drainSubscriberOutbox(
      { ...settings, dailySendCap: 1 },
      [check('api', down()).monitor],
      T + 30,
    );
    expect(network).toHaveBeenCalledTimes(2);
    expect(sent[0]?.body[0]?.to).toEqual(['person1@example.com']);
  },
);

it('arms an alarm when an incident enqueues without any signup request', async () => {
  const { hub, storage } = createHub();
  hub.record(T, [check('api', down())], policy, true);
  await Promise.resolve();
  expect(await storage.getAlarm()).toBe(T * 1000);
});

it('leaves expiry, error-change and reminder claims idle for subscriber-only monitors', () => {
  const { hub, db } = createHub();
  const subscriberPolicy = { ...policy, webhookIds: [] };
  const warning = check('api', {
    ok: true,
    latency: 10,
    warning: { text: 'Domain expires soon', expiryDate: T + 86400 },
  });
  warning.monitor.reminderEveryChecks = 1;
  expect(hub.record(T, [warning], subscriberPolicy, true).alerts).toEqual([]);
  expect(db.prepare('SELECT * FROM expiry_alerts').all()).toEqual([]);
  const failed = check('api', down());
  failed.monitor.reminderEveryChecks = 1;
  const first = hub.record(T + 60, [failed], subscriberPolicy, true);
  hub.confirmAlerts(first.alerts.map((event) => ({ ...event, delivered: true })));
  const changed = { ...failed, check: { location: 'HEL', result: down('changed') } };
  expect(hub.record(T + 120, [changed], subscriberPolicy, true).alerts).toEqual([]);
  expect(hub.record(T + 180, [changed], subscriberPolicy, true).alerts).toEqual([]);
  expect(outbox(db).map(({ kind }) => kind)).toEqual(['down']);
});

it.each([60, 86400])(
  'resumes Cloudflare after each recorded recipient across restart after %s seconds',
  async (delay) => {
    const recipients: string[][] = [];
    let fail = true;
    const binding = {
      async send(message: { to: string[] }) {
        if (recipients.length === 1 && fail)
          throw Object.assign(new Error('slow down'), { code: 'E_RATE_LIMIT_EXCEEDED' });
        recipients.push(message.to);
      },
    };
    const env = {
      SUBSCRIBER_EMAIL: binding,
      SUBSCRIBER_SECRET: 'secret',
      PUBLIC_ORIGIN: mailEnv.PUBLIC_ORIGIN,
    };
    const { hub, db, storage } = createHub(undefined, env);
    confirmed(db, 3);
    const monitors = [check('api', down()).monitor];
    hub.record(T, [check('api', down())], policy, true);
    const options = { ...settings, provider: 'cloudflare' as const, dailySendCap: 3 };
    await hub.drainSubscriberOutbox(options, monitors, T);
    expect(recipients).toEqual([['person1@example.com']]);
    expect(await storage.getAlarm()).toBe((T + 30) * 1000);
    expect(db.prepare('SELECT batch FROM subscriber_outbox').get()?.batch).toContain('"sent":1');
    fail = false;
    await createHub(db, env).hub.drainSubscriberOutbox(options, monitors, T + delay);
    expect(recipients).toEqual([
      ['person1@example.com'],
      ['person2@example.com'],
      ['person3@example.com'],
    ]);
    expect(db.prepare('SELECT id FROM subscriber_outbox WHERE batch IS NOT NULL').all()).toEqual(
      [],
    );
    expect(
      db.prepare("SELECT value FROM meta WHERE key = 'subscriber_sends'").get()?.value,
    ).toContain(`"count":${delay === 60 ? 3 : 2}`);
  },
);

it.each(['E_SENDER_NOT_VERIFIED', 'E_SENDER_DOMAIN_NOT_AVAILABLE'])(
  'logs permanent Cloudflare %s without a retry loop',
  async (code) => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error('verify status.example.com'), { code });
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { hub, db } = createHub(undefined, {
      SUBSCRIBER_SECRET: mailEnv.SUBSCRIBER_SECRET,
      PUBLIC_ORIGIN: mailEnv.PUBLIC_ORIGIN,
      SUBSCRIBER_EMAIL: { send },
    });
    confirmed(db, 2);
    hub.record(T, [check('api', down())], policy, true);
    const options = { ...settings, provider: 'cloudflare' as const };
    const monitors = [check('api', down()).monitor];
    await hub.drainSubscriberOutbox(options, monitors, T);
    await hub.drainSubscriberOutbox(options, monitors, T + 60);
    expect(send).toHaveBeenCalledTimes(1);
    expect(outbox(db)).toEqual([]);
    expect(log).toHaveBeenCalledWith('Permanent subscriber send failure', {
      event: 1,
      cause: `Error: ${code}: Error: verify status.example.com`,
    });
    expect(log.mock.calls.flatMap((call) => JSON.stringify(call)).join()).toContain(
      'status.example.com',
    );
  },
);

it('uses the Cloudflare batch size and daily cap', async () => {
  const recipients: string[] = [];
  const { hub, db, storage } = createHub(undefined, {
    ...mailEnv,
    SUBSCRIBER_EMAIL: {
      async send(message) {
        recipients.push(...message.to);
      },
    },
  });
  confirmed(db, 12);
  hub.record(T, [check('api', down())], policy, true);
  const options = { ...settings, provider: 'cloudflare' as const, dailySendCap: 11 };
  const monitors = [check('api', down()).monitor];
  await hub.drainSubscriberOutbox(options, monitors, T);
  expect(recipients).toHaveLength(11);
  expect(db.prepare('SELECT batch_index FROM subscriber_outbox').get()?.batch_index).toBe(2);
  expect(await storage.getAlarm()).toBe((Math.floor(T / 86400) + 1) * 86400000);
  await hub.drainSubscriberOutbox(options, monitors, T + 86400);
  expect(recipients).toHaveLength(12);
});

it('sends every Cloudflare adapter message as a separate plain object', async () => {
  const messages = await Promise.all(
    ['one@example.com', 'two@example.com'].map((email) =>
      subscriberMail(settings.from, mailEnv.PUBLIC_ORIGIN, mailEnv.SUBSCRIBER_SECRET, email, {
        kind: 'down',
        name: 'API',
        start: T,
      }),
    ),
  );
  const received: unknown[] = [];
  const sender = cloudflareSender({
    async send(message) {
      received.push(message);
    },
  });
  await sender.send(messages, 'unused');
  expect(received).toEqual(messages);
  expect(messages.map(({ to }) => to)).toEqual([['one@example.com'], ['two@example.com']]);
});

it('allows another down notice after reopen but keeps relapse in the same notice cycle', () => {
  const { hub, db } = createHub();
  const record = (at: number, ok: boolean) => {
    const result = hub.record(at, [check('api', ok ? up() : down())], policy, true);
    hub.confirmAlerts(result.alerts.map((alert) => ({ ...alert, delivered: true })));
  };
  record(T, false);
  record(T + 60, true);
  record(T + 120, false);
  expect(outbox(db).map(({ kind }) => kind)).toEqual(['down', 'recovered', 'down']);
  record(T + 180, true);
  record(T + 240, false);
  expect(outbox(db).map(({ kind }) => kind)).toEqual(['down', 'recovered', 'down']);
});

it('replays the same recipients and key after a crash between send and cursor write', async () => {
  const { hub, db } = createHub(undefined, mailEnv);
  confirmed(db, 2);
  hub.record(T, [check('api', down())], policy, true);
  const { sent } = captureMail();
  db.exec(`CREATE TRIGGER crash_cursor BEFORE UPDATE ON subscriber_outbox
    WHEN NEW.sent_to > OLD.sent_to OR NEW.attempts > OLD.attempts
    BEGIN SELECT RAISE(ABORT, 'crash before cursor write'); END;`);
  await expect(
    hub.drainSubscriberOutbox(settings, [check('api', down()).monitor], T),
  ).rejects.toThrow('crash before cursor write');
  expect(db.prepare('SELECT sent_to, batch_index, attempts FROM subscriber_outbox').get()).toEqual({
    sent_to: 0,
    batch_index: 0,
    attempts: 0,
  });
  db.exec('DROP TRIGGER crash_cursor');
  const restarted = createHub(db, mailEnv).hub;
  await restarted.drainSubscriberOutbox(
    { ...settings, dailySendCap: 2 },
    [check('api', down()).monitor],
    T + 30,
  );
  expect(sent.map(({ key }) => key)).toEqual([sent[0]?.key, sent[0]?.key]);
  expect(sent.map(({ body }) => body.map(({ to }) => to))).toEqual([
    [['person1@example.com'], ['person2@example.com']],
    [['person1@example.com'], ['person2@example.com']],
  ]);
  expect(sent[1]?.body).toEqual(sent[0]?.body);
  expect(db.prepare('SELECT sent_to, batch_index, attempts FROM subscriber_outbox').get()).toEqual({
    sent_to: 2,
    batch_index: 1,
    attempts: 0,
  });
});

it('keeps recipient IDs stable when addresses leave and join between batches', async () => {
  const { hub, db } = createHub(undefined, mailEnv);
  confirmed(db, 102);
  hub.record(T, [check('api', down())], policy, true);
  const { sent } = captureMail((batch) => {
    if (batch !== 1) return;
    hub.unsubscribe('person1@example.com');
    hub.unsubscribe('person101@example.com');
    hub.subscribe('person1@example.com', T + 1);
    hub.confirmSubscriber('person1@example.com', '103', T + 1);
    hub.subscribe('new@example.com', T + 1);
    hub.confirmSubscriber('new@example.com', '104', T + 1);
  });
  await hub.drainSubscriberOutbox(
    { ...settings, dailySendCap: 101 },
    [check('api', down()).monitor],
    T,
  );
  expect(sent.map(({ key }) => key)).toEqual([
    expect.stringMatching(/^subscribers\/[0-9a-f-]{36}\/1\/0$/),
    expect.stringMatching(/^subscribers\/[0-9a-f-]{36}\/1\/1$/),
  ]);
  expect(sent.flatMap(({ body }) => body.flatMap(({ to }) => to))).toEqual([
    ...Array.from({ length: 100 }, (_, index) => `person${index + 1}@example.com`),
    'person102@example.com',
  ]);
});

it('does not enqueue recovery when subscribers missed the incident down notice', () => {
  const { hub, db } = createHub();
  const first = hub.record(T, [check('api', down())], policy, false);
  hub.confirmAlerts(first.alerts.map((alert) => ({ ...alert, delivered: true })));
  hub.record(T + 60, [check('api', up())], policy, true);
  expect(outbox(db)).toEqual([]);
  expect(
    db.prepare('SELECT subscriber_notified, subscriber_recovered FROM incidents').get(),
  ).toEqual({ subscriber_notified: 0, subscriber_recovered: 0 });
});

it.each([
  [400, 'validation_error'],
  [400, 'invalid_idempotency_key'],
  [422, 'missing_required_field'],
  [422, 'invalid_parameter'],
  [409, 'invalid_idempotent_request'],
  [400, null],
  [422, null],
])('skips only the rejected batch for Resend %s %s', async (status, name) => {
  const { hub, db } = createHub(undefined, mailEnv);
  confirmed(db, 101);
  hub.record(T, [check('api', down())], policy, true);
  const { network, sent } = captureMail();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  network.mockResolvedValueOnce(
    name === null
      ? new Response('invalid', { status })
      : Response.json({ name, message: mailEnv.RESEND_API_KEY }, { status }),
  );
  await hub.drainSubscriberOutbox(settings, [check('api', down()).monitor], T);
  expect(sent.flatMap(({ body }) => body.flatMap(({ to }) => to))).toEqual([
    'person101@example.com',
  ]);
  expect(outbox(db)).toEqual([]);
  const error = JSON.stringify(log.mock.calls);
  expect(error).toContain('https://api.resend.com/emails/batch');
  expect(error).toContain(String(status));
  expect(error).toContain(name ?? 'unknown');
  expect(error).not.toContain(mailEnv.RESEND_API_KEY);
});

it.each(['daily_quota_exceeded', 'monthly_quota_exceeded'])(
  'keeps the batch until next UTC day for %s',
  async (name) => {
    const { hub, db, storage } = createHub(undefined, mailEnv);
    confirmed(db, 1);
    hub.record(T, [check('api', down())], policy, true);
    const { network, sent } = captureMail();
    network.mockResolvedValueOnce(Response.json({ name }, { status: 429 }));
    await hub.drainSubscriberOutbox(settings, [check('api', down()).monitor], T);
    expect(await storage.getAlarm()).toBe((Math.floor(T / 86400) + 1) * 86400000);
    expect(db.prepare('SELECT batch FROM subscriber_outbox').get()?.batch).toBeTypeOf('string');
    expect(sent).toEqual([]);
    const midnight = (Math.floor(T / 86400) + 1) * 86400;
    await hub.drainSubscriberOutbox(settings, [check('api', down()).monitor], midnight);
    expect(network.mock.calls[1]?.[1]?.body).toBe(network.mock.calls[0]?.[1]?.body);
  },
);

it.each([
  [409, 'concurrent_idempotent_requests'],
  [409, 'resource_locked'],
  [409, null],
  [429, 'rate_limit_exceeded'],
  [429, null],
  [401, 'validation_error'],
  [403, 'validation_error'],
  [500, 'application_error'],
  [503, 'service_unavailable'],
  [401, null],
  [403, null],
  [503, null],
])('retains Resend %s %s with capped backoff', async (status, name) => {
  const { hub, db, storage } = createHub(undefined, mailEnv);
  confirmed(db, 1);
  hub.record(T, [check('api', down())], policy, true);
  const { network } = captureMail();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  network.mockImplementation(async () =>
    name === null
      ? new Response('invalid', { status })
      : Response.json({ name, message: mailEnv.RESEND_API_KEY }, { status }),
  );
  const monitors = [check('api', down()).monitor];
  await hub.drainSubscriberOutbox(settings, monitors, T);
  const batch = db.prepare('SELECT batch FROM subscriber_outbox').get()?.batch;
  expect(batch).toBeTypeOf('string');
  expect(await storage.getAlarm()).toBe((T + 30) * 1000);
  expect(log).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(log.mock.calls)).toContain(`answered ${status} (${name ?? 'unknown'})`);
  expect(JSON.stringify(log.mock.calls)).toContain('https://api.resend.com/emails/batch');
  expect(JSON.stringify(log.mock.calls)).not.toContain(mailEnv.RESEND_API_KEY);
  db.exec('UPDATE subscriber_outbox SET attempts = 20');
  await hub.drainSubscriberOutbox(settings, monitors, T + 30);
  expect(await storage.getAlarm()).toBe((T + 30 + 3600) * 1000);
  expect(db.prepare('SELECT batch FROM subscriber_outbox').get()?.batch).toBe(batch);
});

it('gives two installs distinct keys for the same row and batch', async () => {
  const keys: (string | null)[] = [];
  for (let install = 0; install < 2; install++) {
    const { hub, db } = createHub(undefined, mailEnv);
    confirmed(db, 1);
    hub.record(T, [check('api', down())], policy, true);
    const { sent } = captureMail();
    await hub.drainSubscriberOutbox(settings, [check('api', down()).monitor], T);
    keys.push(sent[0]!.key);
    expect(sent[0]!.key).toMatch(/^subscribers\/[0-9a-f-]{36}\/1\/0$/);
  }
  expect(keys[0]).not.toBe(keys[1]);
});

it('uses the delivery index without a temporary B-tree', () => {
  const { db } = createHub();
  const plan = db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT * FROM subscriber_outbox ORDER BY kind = 'confirm', id LIMIT 1",
    )
    .all();
  expect(plan.map(({ detail }) => detail).join('\n')).toContain(
    'USING INDEX subscriber_outbox_delivery',
  );
  expect(plan.map(({ detail }) => detail).join('\n')).not.toContain('TEMP B-TREE');
  const partner = db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT id FROM subscriber_outbox WHERE (kind = 'confirm') = 0 AND id > ? AND incident_id = ? AND kind = 'recovered' AND sent_to = 0 AND batch_index = 0 AND batch IS NULL LIMIT 1",
    )
    .all(1, 1);
  expect(partner.map(({ detail }) => detail).join('\n')).toContain(
    'USING INDEX subscriber_outbox_delivery (<expr>=? AND id>?)',
  );
  const expiry = db
    .prepare(
      "EXPLAIN QUERY PLAN DELETE FROM subscriber_outbox WHERE kind = 'confirm' AND created_at <= ?",
    )
    .all(T);
  expect(expiry.map(({ detail }) => detail).join('\n')).toContain(
    'USING INDEX subscriber_outbox_expiry',
  );
  const indexes = db.prepare("PRAGMA index_list('subscriber_outbox')").all();
  expect(new Set(indexes.filter(({ partial }) => partial === 0).map(({ name }) => name))).toEqual(
    new Set(['subscriber_outbox_delivery']),
  );
});

it.each([1, 200])(
  'deletes an unstarted incident pair before the quota check (cap %s)',
  async (dailySendCap) => {
    const { hub, db } = createHub(undefined, mailEnv);
    confirmed(db, 1);
    if (dailySendCap === 1)
      db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(
        'subscriber_sends',
        JSON.stringify({ day: Math.floor(T / 86400), count: 1 }),
      );
    hub.record(T, [check('api', down())], policy, true);
    hub.record(T + 60, [check('api', up())], policy, true);
    expect(db.prepare('SELECT incident_id FROM subscriber_outbox ORDER BY id').all()).toEqual([
      { incident_id: 1 },
      { incident_id: 1 },
    ]);
    const { network } = captureMail();
    await hub.drainSubscriberOutbox(
      { ...settings, dailySendCap },
      [check('api', down()).monitor],
      T + 60,
    );
    expect(outbox(db)).toEqual([]);
    expect(network).not.toHaveBeenCalled();
    expect(
      db.prepare('SELECT subscriber_notified, subscriber_recovered FROM incidents').get(),
    ).toEqual({ subscriber_notified: 1, subscriber_recovered: 1 });
  },
);

it.each(['sent one batch', 'batch persisted'])(
  'finishes down and recovery when down has %s',
  async (progress) => {
    const { hub, db } = createHub(undefined, mailEnv);
    confirmed(db, 2);
    hub.record(T, [check('api', down())], policy, true);
    const { network, sent } = captureMail();
    if (progress === 'batch persisted') network.mockRejectedValueOnce(new Error('connection lost'));
    await hub.drainSubscriberOutbox(
      { ...settings, dailySendCap: 1 },
      [check('api', down()).monitor],
      T,
    );
    hub.record(T + 60, [check('api', up())], policy, true);
    await hub.drainSubscriberOutbox(settings, [check('api', down()).monitor], T + 60);
    expect(sent.flatMap(({ body }) => body.map(({ text }) => text))).toEqual([
      expect.stringContaining('api is down'),
      expect.stringContaining('api is down'),
      expect.stringContaining('api is up'),
      expect.stringContaining('api is up'),
    ]);
    expect(outbox(db)).toEqual([]);
  },
);

it('bounds twenty closed incidents while the daily cap is used up', async () => {
  const { hub, db } = createHub(undefined, mailEnv);
  confirmed(db, 1);
  const { network } = captureMail();
  for (let incident = 0; incident < 20; incident++) {
    const at = T + incident * 1000;
    hub.record(at, [check('api', down())], policy, true);
    hub.record(at + 60, [check('api', up())], policy, true);
  }
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(
    'subscriber_sends',
    JSON.stringify({ day: Math.floor((T + 20_000) / 86400), count: 1 }),
  );
  hub.record(T + 20_000, [check('api', down())], policy, true);
  await hub.drainSubscriberOutbox(
    { ...settings, dailySendCap: 1 },
    [check('api', down()).monitor],
    T + 20_000,
  );
  expect(outbox(db).map(({ kind }) => kind)).toEqual(['down']);
  expect(network).not.toHaveBeenCalled();
});

it('rejects a stale generation after the same address signs up again', () => {
  const { hub } = createHub();
  hub.subscribe('one@example.com', T);
  hub.unsubscribe('one@example.com');
  hub.subscribe('one@example.com', T + 1);
  expect(hub.confirmSubscriber('one@example.com', '1', T + 2)).toBe(false);
  expect(hub.confirmSubscriber('one@example.com', '2', T + 2)).toBe(true);
  expect(hub.confirmSubscriber('one@example.com', '2', T + 3)).toBe(true);
  expect(hub.subscriberCount()).toBe(1);
});

it('keeps the original confirmation time on repeated confirmation', () => {
  const { hub, db } = createHub();
  hub.subscribe('one@example.com', T);
  expect(hub.confirmSubscriber('one@example.com', '1', T + 1)).toBe(true);
  expect(hub.confirmSubscriber('one@example.com', '1', T + 86400)).toBe(true);
  expect(db.prepare('SELECT confirmed_at FROM subscribers').get()).toEqual({ confirmed_at: T + 1 });
});

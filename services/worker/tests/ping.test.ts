import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  heartbeatKvKey,
  KV_KEYS,
  type HeartbeatMonitor,
  type HeartbeatSignal,
  type Monitor,
  type MonitorState,
  type WorkerConfig,
} from '@flarewatch/shared';
import type { Env } from '../src/env';
import Worker, { runChecks } from '../src/index';
import { deriveHeartbeatToken } from '../src/ping';
import { asKv, createKv } from './helpers/kv';
import { createWorkerDeps } from './helpers/worker-deps';

const workerConfigMock: WorkerConfig = { monitors: [] };

const NOW = Date.parse('2025-01-15T12:00:00Z') / 1000;
const SECRET = 'test-heartbeat-secret';

const heartbeat: HeartbeatMonitor = {
  id: 'backup',
  name: 'Nightly backup',
  method: 'HEARTBEAT',
  periodSeconds: 3600,
  graceSeconds: 60,
};
const pullMonitor: Monitor = {
  id: 'api',
  name: 'API',
  method: 'GET',
  target: 'https://example.com',
};

function token(id: string = heartbeat.id): Promise<string> {
  return deriveHeartbeatToken(SECRET, id);
}

function createEnv(extra: Partial<Env> = {}): Env {
  return { FLAREWATCH_STATE: asKv(kv), HEARTBEAT_SECRET: SECRET, ...extra };
}

function pingRequest(path: string, init: { method?: string; body?: string } = {}): Request {
  return new Request(`https://worker.test${path}`, {
    method: init.method ?? 'GET',
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
}

let kv = createKv();

async function ping(
  path: string,
  init?: { method?: string; body?: string },
  env: Env = createEnv(),
): Promise<Response> {
  return Worker.fetch(
    pingRequest(path, init),
    env,
    {} as ExecutionContext,
    createWorkerDeps(workerConfigMock),
  );
}

function signal(): HeartbeatSignal {
  const value = kv.values.get(heartbeatKvKey(heartbeat.id));
  if (typeof value !== 'string') throw new Error('Signal was not saved');
  return JSON.parse(value) as HeartbeatSignal;
}

function seedSignal(value: HeartbeatSignal): void {
  kv.values.set(heartbeatKvKey(heartbeat.id), structuredClone(value));
}

describe('heartbeat tokens', () => {
  it('are stable, 32 characters long, and distinct per id', async () => {
    const first = await token();
    const second = await token();

    expect(first).toBe(second);
    expect(first).toHaveLength(32);
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await token('other-job')).not.toBe(first);
  });
});

describe('ping routes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW * 1000));
    workerConfigMock.monitors = [heartbeat, pullMonitor];
    kv = createKv();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['GET', 'POST', 'HEAD'])('records a success ping via %s', async (method) => {
    seedSignal({ lastFail: NOW - 10, message: 'boom' });

    const response = await ping(`/ping/${heartbeat.id}/${await token()}`, { method });

    expect(response.status).toBe(200);
    expect(signal()).toEqual({ lastSuccess: NOW, runs: [{ at: NOW, outcome: 'ok' }] });
    if (method === 'HEAD') {
      await expect(response.text()).resolves.toBe('');
    } else {
      await expect(response.text()).resolves.toBe('OK');
    }
  });

  it('rejects a ping on a corrupt signal, keeps it', async () => {
    kv.values.set(heartbeatKvKey(heartbeat.id), { lastSuccess: 'garbage' });

    await expect(
      ping(`/ping/${heartbeat.id}/${await token()}/fail`, { method: 'POST', body: 'boom' }),
    ).rejects.toThrow('failed validation');
    expect(kv.values.get(heartbeatKvKey(heartbeat.id))).toEqual({ lastSuccess: 'garbage' });
  });

  it('records a late success only past period plus grace', async () => {
    seedSignal({ lastSuccess: NOW - 3659 });

    await ping(`/ping/${heartbeat.id}/${await token()}`);

    // One second past the period but inside the 60 s grace window.
    expect(signal().runs).toEqual([{ at: NOW, outcome: 'ok' }]);

    seedSignal({ lastSuccess: NOW - 4000 });
    await ping(`/ping/${heartbeat.id}/${await token()}`);

    expect(signal().runs).toEqual([{ at: NOW, outcome: 'late' }]);
  });

  it('replaces a retry within 30 s, appends after a period', async () => {
    seedSignal({ lastSuccess: NOW - 3600, runs: [{ at: NOW - 10, outcome: 'ok' }] });

    await ping(`/ping/${heartbeat.id}/${await token()}`);

    expect(signal().runs).toEqual([{ at: NOW, outcome: 'ok' }]);

    // A 60 s period accumulates history: the next ping is not a retry.
    vi.setSystemTime(new Date((NOW + 60) * 1000));
    await ping(`/ping/${heartbeat.id}/${await token()}`);

    expect(signal().runs).toEqual([
      { at: NOW, outcome: 'ok' },
      { at: NOW + 60, outcome: 'ok' },
    ]);
  });

  it('pairs startedAt with the finishing run and consumes it afterwards', async () => {
    seedSignal({ lastSuccess: NOW - 60, lastStart: NOW });

    vi.setSystemTime(new Date((NOW + 120) * 1000));
    await ping(`/ping/${heartbeat.id}/${await token()}`);

    expect(signal().runs).toEqual([{ at: NOW + 120, outcome: 'ok', startedAt: NOW }]);
    expect(signal().lastStart).toBeUndefined();

    vi.setSystemTime(new Date((NOW + 240) * 1000));
    await ping(`/ping/${heartbeat.id}/${await token()}`);

    expect(signal().runs?.[1]).toEqual({ at: NOW + 240, outcome: 'ok' });
  });

  it('keeps a same-second success and fail as two runs', async () => {
    await ping(`/ping/${heartbeat.id}/${await token()}/fail`, { method: 'POST', body: 'boom' });
    await ping(`/ping/${heartbeat.id}/${await token()}`);

    expect(signal().runs).toEqual([
      { at: NOW, outcome: 'fail' },
      { at: NOW, outcome: 'ok' },
    ]);
  });

  it('counts fail body bytes across split chunks', async () => {
    const encoder = new TextEncoder();
    const body = encoder.encode('€'.repeat(5) + 'x'.repeat(1009));
    expect(body.byteLength).toBe(1024);

    const streamFail = async (chunks: Uint8Array[]): Promise<Response> =>
      Worker.fetch(
        new Request(`https://worker.test/ping/${heartbeat.id}/${await token()}/fail`, {
          method: 'POST',
          duplex: 'half',
          body: new ReadableStream({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(chunk);
              controller.close();
            },
          }),
        } as RequestInit),
        createEnv(),
        {} as ExecutionContext,
        createWorkerDeps(workerConfigMock),
      );

    const ok = await streamFail([body.slice(0, 4), body.slice(4)]);
    expect(ok.status).toBe(200);
    expect(signal().message).toBe('€'.repeat(5) + 'x'.repeat(195));

    const oversized = await streamFail([encoder.encode('€'.repeat(342))]);
    expect(oversized.status).toBe(413);
    expect(signal().message).toBe('€'.repeat(5) + 'x'.repeat(195));
  });

  it('caps the run history at 90 entries', async () => {
    const runs = Array.from({ length: 90 }, (_, i) => ({
      at: NOW - 3600 + i,
      outcome: 'ok' as const,
    }));
    seedSignal({ lastSuccess: NOW - 3600, runs });

    await ping(`/ping/${heartbeat.id}/${await token()}`);

    const history = signal().runs ?? [];
    expect(history).toHaveLength(90);
    expect(history[0]).toEqual({ at: NOW - 3599, outcome: 'ok' });
    expect(history[89]).toEqual({ at: NOW, outcome: 'ok' });
  });

  it('records a start ping without touching lastSuccess', async () => {
    seedSignal({ lastSuccess: NOW - 100 });

    const response = await ping(`/ping/${heartbeat.id}/${await token()}/start`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(signal()).toEqual({ lastSuccess: NOW - 100, lastStart: NOW });
  });

  it('records a fail ping with the body as message', async () => {
    const response = await ping(`/ping/${heartbeat.id}/${await token()}/fail`, {
      method: 'POST',
      body: 'backup failed\nchecksum mismatch',
    });

    expect(response.status).toBe(200);
    expect(signal()).toEqual({
      lastFail: NOW,
      message: 'backup failed\nchecksum mismatch',
      runs: [{ at: NOW, outcome: 'fail' }],
    });
  });

  it('caps the fail message at 200 chars and strips control characters', async () => {
    const body = `a\x00b\x1fc\x7f${'d'.repeat(400)}\n`;

    await ping(`/ping/${heartbeat.id}/${await token()}/fail`, { method: 'POST', body });

    const stored = signal();
    expect(stored.message).toHaveLength(200);
    expect(stored.message).toBe(`abc${'d'.repeat(197)}`);
    expect(stored.lastFail).toBe(NOW);
  });

  it('rejects oversized fail bodies with 413 and accepts exactly 1024 bytes', async () => {
    const tok = await token();
    const oversized = await ping(`/ping/${heartbeat.id}/${tok}/fail`, {
      method: 'POST',
      body: 'x'.repeat(1025),
    });
    expect(oversized.status).toBe(413);
    expect(kv.values.has(heartbeatKvKey(heartbeat.id))).toBe(false);

    const exact = await ping(`/ping/${heartbeat.id}/${tok}/fail`, {
      method: 'POST',
      body: 'x'.repeat(1024),
    });
    expect(exact.status).toBe(200);
    expect(signal().message).toHaveLength(200);
  });

  it('treats exit 0 as success and other exit codes as failures', async () => {
    const ok = await ping(`/ping/${heartbeat.id}/${await token()}/0`);
    expect(ok.status).toBe(200);
    expect(signal()).toEqual({ lastSuccess: NOW, runs: [{ at: NOW, outcome: 'ok' }] });

    seedSignal({});
    const failed = await ping(`/ping/${heartbeat.id}/${await token()}/3`, { method: 'POST' });
    expect(failed.status).toBe(200);
    expect(signal()).toEqual({
      lastFail: NOW,
      message: 'exit 3',
      runs: [{ at: NOW, outcome: 'fail' }],
    });
  });

  it('returns 404 for paths outside the route matrix', async () => {
    const tok = await token();
    const paths = [
      `/ping/${heartbeat.id}/${tok}/256`,
      `/ping/${heartbeat.id}/${tok}/abc`,
      `/ping/${heartbeat.id}/${tok}/fail/extra`,
      `/ping/${heartbeat.id}`,
    ];

    for (const path of paths) {
      const response = await ping(path);
      expect(response.status, path).toBe(404);
    }
  });

  it('accepts only the documented methods per route', async () => {
    const tok = await token();
    const requests = [
      { path: `/ping/${heartbeat.id}/${tok}/fail`, method: 'GET' },
      { path: `/ping/${heartbeat.id}/${tok}/start`, method: 'HEAD' },
      { path: `/ping/${heartbeat.id}/${tok}`, method: 'DELETE' },
      { path: `/ping/${heartbeat.id}/${tok}/3`, method: 'PUT' },
    ];

    for (const { path, method } of requests) {
      const response = await ping(path, { method });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
  });

  it('returns 404 for bad token, wrong id, or missing secret', async () => {
    const tok = await token();

    await expect(ping(`/ping/${heartbeat.id}/${'A'.repeat(32)}`)).resolves.toHaveProperty(
      'status',
      404,
    );
    await expect(ping(`/ping/ghost/${await token('ghost')}`)).resolves.toHaveProperty(
      'status',
      404,
    );
    await expect(
      ping(`/ping/${pullMonitor.id}/${await token(pullMonitor.id)}`),
    ).resolves.toHaveProperty('status', 404);
    await expect(
      ping(`/ping/${heartbeat.id}/${tok}`, undefined, { FLAREWATCH_STATE: asKv(kv) }),
    ).resolves.toHaveProperty('status', 404);
  });

  it('never reads CONFIG_KV before the token is verified', async () => {
    const configKv = createKv();
    const get = vi.spyOn(configKv, 'get');

    const response = await ping(`/ping/${heartbeat.id}/${'A'.repeat(32)}`, undefined, {
      ...createEnv(),
      CONFIG_KV: asKv(configKv),
    });

    expect(response.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it('returns 429 when the rate limit binding rejects, keyed by monitor id', async () => {
    const limiter = { limit: vi.fn(async () => ({ success: false })) };

    const limited = await ping(`/ping/${heartbeat.id}/${await token()}`, undefined, {
      ...createEnv(),
      HEARTBEAT_RATE_LIMIT: limiter,
    });

    expect(limited.status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledWith({ key: heartbeat.id });
    expect(kv.values.has(heartbeatKvKey(heartbeat.id))).toBe(false);
  });

  it('passes the rate limiter when it allows the ping', async () => {
    const limiter = { limit: vi.fn(async () => ({ success: true })) };

    const response = await ping(`/ping/${heartbeat.id}/${await token()}`, undefined, {
      ...createEnv(),
      HEARTBEAT_RATE_LIMIT: limiter,
    });

    expect(response.status).toBe(200);
    expect(limiter.limit).toHaveBeenCalledTimes(1);
  });

  it.each([200, 404])('sends no-store and no-referrer headers on %i', async (status) => {
    const response =
      status === 200
        ? await ping(`/ping/${heartbeat.id}/${await token()}`)
        : await ping(`/ping/${heartbeat.id}/bad-token`);

    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('builds ping urls from PUBLIC_ORIGIN and falls back to the request origin', async () => {
    const tok = await token();

    const withVar = await ping(`/ping-url/${heartbeat.id}`, undefined, {
      ...createEnv(),
      PUBLIC_ORIGIN: 'https://status.example.com',
    });
    await expect(withVar.json()).resolves.toEqual({
      url: `https://status.example.com/ping/${heartbeat.id}/${tok}`,
    });

    const fromRequest = await ping(`/ping-url/${heartbeat.id}`);
    await expect(fromRequest.json()).resolves.toEqual({
      url: `https://worker.test/ping/${heartbeat.id}/${tok}`,
    });
  });

  it('ping-url gives 404 for unknown ids, 500 without secret', async () => {
    await expect(ping('/ping-url/ghost')).resolves.toHaveProperty('status', 404);
    await expect(ping(`/ping-url/${pullMonitor.id}`)).resolves.toHaveProperty('status', 404);
    await expect(
      ping(`/ping-url/${heartbeat.id}`, undefined, { FLAREWATCH_STATE: asKv(kv) }),
    ).resolves.toHaveProperty('status', 500);
  });
});

describe('ping to scheduled check end to end', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW * 1000));
    workerConfigMock.monitors = [heartbeat];
    kv = createKv();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks the monitor up after a ping inside the period', async () => {
    const response = await ping(`/ping/${heartbeat.id}/${await token()}`);
    expect(response.status).toBe(200);

    await runChecks(createEnv(), createWorkerDeps(workerConfigMock));

    const state = JSON.parse(kv.values.get(KV_KEYS.STATE) as string) as MonitorState;
    expect(state.heartbeat?.[heartbeat.id]?.status).toBe('up');
    expect(state.heartbeat?.[heartbeat.id]?.lastSuccess).toBe(NOW);
  });
});

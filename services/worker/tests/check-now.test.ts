import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { HeartbeatMonitor, MonitorTarget, WorkerConfig } from '@flarewatch/shared';
import type { Env } from '../src/env';
import Worker, { type WorkerDeps } from '../src/index';
import { createHub, hubNamespace } from './helpers/hub';

const NOW = Date.parse('2025-01-15T12:00:00Z') / 1000;

const api: MonitorTarget = {
  id: 'api v2',
  name: 'API',
  method: 'GET',
  target: 'https://api.example.com/health',
  checkProxy: 'https://proxy.example.com/check',
};
const backup: HeartbeatMonitor = {
  id: 'backup',
  name: 'Backup',
  method: 'HEARTBEAT',
  periodSeconds: 3600,
  graceSeconds: 60,
};
const config: WorkerConfig = { monitors: [api, backup] };

const checkMonitor = vi.fn<WorkerDeps['checkMonitor']>();
const deps: WorkerDeps = {
  checkMonitor,
  createNotifier: () => null,
  getEdgeLocation: async () => 'HEL',
  staticConfig: config,
};

/** A hub that already holds one recorded run, behind a binding that counts every use. */
function createEnv() {
  const { hub } = createHub();
  hub.record(NOW, [
    { monitor: api, check: { location: 'AMS', result: { ok: true, latency: 12 } } },
  ]);
  const namespace = hubNamespace(hub);
  const getByName = vi.spyOn(namespace, 'getByName');
  const env: Env = { MONITOR_HUB: namespace };
  return { hub, env, getByName };
}

function checkNow(env: Env, path: string, init: RequestInit = { method: 'POST' }) {
  return Worker.fetch(
    new Request(`https://internal${path}`, init),
    env,
    {} as ExecutionContext,
    deps,
  );
}

beforeEach(() => {
  checkMonitor.mockReset();
});

describe('check now route for the status page', () => {
  it('checks the configured monitor once and answers its result', async () => {
    const { env } = createEnv();
    checkMonitor.mockResolvedValue({ location: 'FRA', result: { ok: false, error: 'HTTP 503' } });

    const response = await checkNow(env, '/check/api%20v2');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      location: 'FRA',
      result: { ok: false, error: 'HTTP 503' },
    });
    expect(checkMonitor).toHaveBeenCalledTimes(1);
    expect(checkMonitor.mock.calls[0]?.[0]).toBe(api);
  });

  it('records nothing and never touches the hub', async () => {
    const { hub, env, getByName } = createEnv();
    const before = hub.view();
    checkMonitor.mockResolvedValue({ location: 'FRA', result: { ok: false, error: 'HTTP 503' } });

    expect((await checkNow(env, '/check/api%20v2')).status).toBe(200);

    expect(getByName).not.toHaveBeenCalled();
    expect(hub.view()).toEqual(before);
  });

  it('answers a crashed check as a failure from this location', async () => {
    const { env } = createEnv();
    checkMonitor.mockRejectedValue(new Error('socket hang up'));

    const response = await checkNow(env, '/check/api%20v2');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      location: 'HEL',
      result: { ok: false, error: 'Check failed: Error: socket hang up' },
    });
  });

  it.each([
    ['an unknown id', '/check/ghost', { method: 'POST' }, 404],
    ['a heartbeat id', '/check/backup', { method: 'POST' }, 400],
    [
      'a caller-supplied target or proxy',
      '/check/api%20v2',
      {
        method: 'POST',
        body: JSON.stringify({ target: 'https://evil.test', checkProxy: 'https://evil.test' }),
      },
      400,
    ],
    ['a query string', '/check/api%20v2?target=https://evil.test', { method: 'POST' }, 400],
    ['a malformed id', '/check/%E0%A4%A', { method: 'POST' }, 400],
    ['a GET', '/check/api%20v2', { method: 'GET' }, 404],
  ])('refuses %s without checking', async (_name, path, init, status) => {
    const { env } = createEnv();

    const response = await checkNow(env, path, init);

    expect(response.status).toBe(status);
    expect(checkMonitor).not.toHaveBeenCalled();
  });
});

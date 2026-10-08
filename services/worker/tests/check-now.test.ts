import { getEdgeLocation as locateEdge } from '../src/utils/location';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  isCheckResultWithLocation,
  type Fetcher,
  type HeartbeatMonitor,
  type MonitorTarget,
  type WorkerConfig,
} from '@flarewatch/shared';
import { checkMonitor } from '../src/checkers';
import { createNotifier } from '../src/notifications/webhook';
import { HttpChecker } from '../src/checkers/http';
import { TcpChecker } from '../src/checkers/tcp';
import { GlobalPingChecker } from '../src/checkers/globalping';
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

const fetchMock = vi.fn<Fetcher>();
const edge = () => locateEdge(async () => new Response('colo=HEL\n'));

const deps: WorkerDeps = {
  checkMonitor: (target, ctx) =>
    checkMonitor(target, ctx, {
      http: new HttpChecker(fetchMock),
      tcp: new TcpChecker(async () => {
        throw new Error('no socket in this test');
      }),
      globalPing: new GlobalPingChecker(fetchMock),
      getEdgeLocation: edge,
      fetcher: fetchMock,
    }),
  createNotifier,
  getEdgeLocation: edge,
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

function checkNow(env: Env, path: string, init: RequestInit = { method: 'POST' }, deps_ = deps) {
  return Worker.fetch(
    new Request(`https://internal${path}`, init),
    env,
    {} as ExecutionContext,
    deps_,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('check now route for the status page', () => {
  it('checks the configured monitor once and answers its result', async () => {
    const { env } = createEnv();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ location: 'FRA', result: { ok: false, error: 'HTTP 503' } })),
    );

    const response = await checkNow(env, '/check/api%20v2');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      location: 'FRA',
      result: { ok: false, error: 'HTTP 503' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://proxy.example.com/check');
    expect(JSON.parse(typeof options?.body === 'string' ? options.body : '')).toMatchObject({
      id: 'api v2',
      target: 'https://api.example.com/health',
    });
  });

  it('records nothing and never touches the hub', async () => {
    const { hub, env, getByName } = createEnv();
    const before = hub.view();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ location: 'FRA', result: { ok: false, error: 'HTTP 503' } })),
    );

    expect((await checkNow(env, '/check/api%20v2')).status).toBe(200);

    expect(getByName).not.toHaveBeenCalled();
    expect(hub.view()).toEqual(before);
  });

  it('answers a rejected network request as a failure from this location', async () => {
    const { env } = createEnv();
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    const { checkProxy: _proxy, ...direct } = api;
    const response = await checkNow(
      env,
      '/check/api%20v2',
      { method: 'POST' },
      {
        ...deps,
        staticConfig: { monitors: [direct, backup] },
      },
    );

    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    expect(result).toMatchObject({
      location: 'HEL',
      result: { ok: false, error: 'socket hang up' },
    });
    if (!isCheckResultWithLocation(result)) throw new Error('Expected a located check result');
    expect(result.result.latency).toBeTypeOf('number');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/health');
  });

  it('answers a crashed check as a failure from this location', async () => {
    const { env } = createEnv();
    const response = await checkNow(
      env,
      '/check/api%20v2',
      { method: 'POST' },
      {
        ...deps,
        checkMonitor: () => Promise.reject(new Error('socket hang up')),
      },
    );

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
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

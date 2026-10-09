import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { workerConfig } from '@flarewatch/config/worker';
import { forgetCachedView } from '@/lib/snapshots';
import { authMiddlewareServer } from '@/server/auth-middleware';
import { Route } from '@/routes/api/badge';

const T = Date.parse('2025-01-15T12:00:00Z') / 1000;
const originalMonitors = workerConfig.monitors;
afterEach(() => {
  workerConfig.monitors = originalMonitors;
  forgetCachedView();
});

function stubView(status: 'up' | 'down' = 'up', extra = {}) {
  vi.stubEnv('DEV', false);
  vi.stubGlobal('__env__', {
    MONITOR_WORKER: {
      fetch: async () =>
        Response.json({
          lastUpdate: T,
          maintenances: [],
          announcements: [],
          monitors: {
            demo_example: {
              status,
              startedAt: T,
              incidents: status === 'down' ? [{ start: [T], error: ['Outage'] }] : [],
              ...extra,
            },
          },
        }),
    },
  });
}

type Handler = (ctx: { request: Request }) => Promise<Response>;
function get(path = '/api/badge?id=demo_example') {
  const options = Route.options as { server?: { handlers?: Record<string, Handler> } };
  const handler = options.server?.handlers?.GET;
  if (!handler) throw new Error('Missing badge GET');
  const request = new Request(`https://flarewatch.test${path}`);
  return authMiddlewareServer({
    request,
    pathname: new URL(request.url).pathname,
    next: () => handler({ request }),
  } as never) as Promise<Response>;
}

describe('GET /api/badge', () => {
  it('serves unknown before a monitor reports its first result and refuses a missing monitor', async () => {
    stubView('up', { startedAt: undefined });
    const firstResultPending = await get();
    expect(firstResultPending.status).toBe(200);
    expect(await firstResultPending.json()).toMatchObject({
      message: 'unknown',
      color: 'lightgrey',
    });

    expect((await get('/api/badge?id=no_such_monitor')).status).toBe(404);
  });
});

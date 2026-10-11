import { afterEach, describe, expect, it } from 'vite-plus/test';
import { workerConfig } from '@flarewatch/config/worker';
import { Route } from '@/routes/api/badge';
import { callBadge, stubBadgeView } from '../helpers/badge';
import { forgetViewAroundEachTest } from '../helpers/snapshots';

const originalMonitors = workerConfig.monitors;
afterEach(() => {
  workerConfig.monitors = originalMonitors;
});
forgetViewAroundEachTest();

const get = (path = '/api/badge?id=demo_example') => callBadge(Route, path);

describe('GET /api/badge', () => {
  it('serves unknown before a monitor reports its first result and refuses a missing monitor', async () => {
    stubBadgeView('up', { startedAt: undefined });
    const firstResultPending = await get();
    expect(firstResultPending.status).toBe(200);
    expect(await firstResultPending.json()).toMatchObject({
      message: 'unknown',
      color: 'lightgrey',
    });

    expect((await get('/api/badge?id=no_such_monitor')).status).toBe(404);
  });
});

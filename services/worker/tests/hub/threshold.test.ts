import { expect, it } from 'vite-plus/test';
import type { CheckResult } from '@flarewatch/shared';
import { createHub } from '../helpers/hub';

it('counts actual failures, resets on success and starts the incident at the first failure', () => {
  const { hub } = createHub();
  const monitor = {
    id: 'api',
    name: 'API',
    method: 'GET' as const,
    target: 'https://example.com',
    downAfterChecks: 3,
  };
  const record = (now: number, result?: CheckResult) =>
    hub.record(now, [{ monitor, ...(result && { check: { location: 'HEL', result } }) }]);
  const down: CheckResult = { ok: false, error: 'down' };
  record(1000, down);
  expect(hub.view().monitors.api?.status).toBe('up');
  record(1060);
  record(1120, down);
  expect(hub.view().monitors.api?.incidents).toEqual([]);
  record(1180, { ok: true, latency: 1 });
  record(1240, down);
  record(1300, down);
  const { updates } = record(1360, down);
  expect(updates[0]).toMatchObject({ isUp: false, incidentStartTime: 1240 });
  expect(hub.view().monitors.api?.incidents).toEqual([{ start: [1240], error: ['down'] }]);
  record(1420, { ok: true, latency: 1 });
  expect(hub.view().monitors.api?.incidents[0]?.end).toBe(1420);
});

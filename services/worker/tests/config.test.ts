import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vite-plus/test';
import { accessConfigIssues, configIssues } from '@flarewatch/shared';
import { pageConfig } from '@flarewatch/config';
import { workerConfig } from '@flarewatch/config/worker';
import { workerConfig as demoWorker } from '../../../packages/config/src/demo/worker';
import { pageConfig as demoPage } from '../../../packages/config/src/demo/public';
import { accessConfig as accessExample } from '../../../packages/config/src/access.example';
import { pageConfig as pageExample } from '../../../packages/config/src/public.example';
import { workerConfig as workerExample } from '../../../packages/config/src/worker.example';
import { capacityIssue, planIssues } from '../src/checkers';
import type { MonitorTarget } from '@flarewatch/shared';

describe.each([
  ['starter', workerConfig, pageConfig],
  ['demo', demoWorker, demoPage],
])('packages/config %s', (_name, worker, page) => {
  it('is valid, so a broken config fails CI instead of deploying', () => {
    expect(
      configIssues({
        monitors: worker.monitors,
        statusPage: page,
        notification: worker.notification,
      }),
    ).toEqual([]);
  });

  it('asks each check location only for what it can do', () => {
    const issues = worker.monitors.flatMap((monitor) =>
      monitor.method === 'HEARTBEAT'
        ? []
        : planIssues(monitor).map((issue) => `monitor "${monitor.id}": ${issue}`),
    );
    expect(issues).toEqual([]);
  });

  it('fits the checks due every minute into one check run', () => {
    const webhooks = [worker.notification?.webhook ?? []].flat().length;
    expect(capacityIssue(worker.monitors, webhooks)).toBeUndefined();
  });
});

describe('capacityIssue', () => {
  const gets = (count: number, checkEveryMinutes?: number): MonitorTarget[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `m${i}`,
      name: `M${i}`,
      method: 'GET',
      target: `https://m${i}.example.com`,
      ...(checkEveryMinutes !== undefined && { checkEveryMinutes }),
    }));
  const domains = (count: number): MonitorTarget[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `d${i}`,
      name: `D${i}`,
      method: 'DOMAIN',
      target: `d${i}.com`,
      checkEveryMinutes: 1,
    }));

  it('allows 47 every-minute checks: 50 subrequests less 3 for the hub', () => {
    expect(capacityIssue(gets(47), 0)).toBeUndefined();
    expect(capacityIssue(gets(48), 0)).toBeDefined();
  });

  it('takes one more subrequest for each webhook', () => {
    expect(capacityIssue(gets(46), 1)).toBeUndefined();
    expect(capacityIssue(gets(47), 1)).toBeDefined();
  });

  it('counts a DOMAIN check as two', () => {
    expect(capacityIssue(domains(23), 0)).toBeUndefined();
    expect(capacityIssue(domains(24), 0)).toBeDefined();
  });

  it('leaves out checks on a longer interval and heartbeats', () => {
    expect(
      capacityIssue(
        [
          ...gets(60, 2),
          { id: 'daily', name: 'Daily', method: 'DOMAIN', target: 'example.com' },
          { id: 'job', name: 'Job', method: 'HEARTBEAT', periodSeconds: 60, graceSeconds: 60 },
        ],
        0,
      ),
    ).toBeUndefined();
  });
});

describe('packages/config examples', () => {
  it('are valid together, so a fork that copies all three deploys', () => {
    expect([
      ...configIssues({
        monitors: workerExample.monitors,
        statusPage: pageExample,
        notification: workerExample.notification,
      }),
      ...accessConfigIssues(accessExample, Object.keys(pageExample.group ?? {})),
    ]).toEqual([]);
  });
});

describe('wrangler config', () => {
  // The worker's routes have no auth of their own; the service binding is the only way in.
  it.each(['wrangler.toml', 'wrangler-dev.toml'])(
    '%s keeps the worker off the internet',
    (file) => {
      const toml = readFileSync(`${import.meta.dirname}/../${file}`, 'utf8');

      expect(toml).toMatch(/^workers_dev = false$/m);
      expect(toml).toMatch(/^preview_urls = false$/m);
      expect(toml).not.toMatch(/^\s*(\[\[)?(routes?|custom_domain)\b/m);
    },
  );
});

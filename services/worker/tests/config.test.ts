import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vite-plus/test';
import { accessConfigIssues, configIssues } from '@flarewatch/shared';
import { pageConfig } from '@flarewatch/config';
import { workerConfig } from '@flarewatch/config/worker';
import { accessConfig as accessExample } from '../../../packages/config/src/access.example';
import { pageConfig as pageExample } from '../../../packages/config/src/public.example';
import { workerConfig as workerExample } from '../../../packages/config/src/worker.example';
import { planIssues } from '../src/checkers';

describe('packages/config', () => {
  it('is valid, so a broken config fails CI instead of deploying', () => {
    expect(
      configIssues({
        monitors: workerConfig.monitors,
        statusPage: pageConfig,
        notification: workerConfig.notification,
      }),
    ).toEqual([]);
  });

  it('asks each check location only for what it can do', () => {
    const issues = workerConfig.monitors.flatMap((monitor) =>
      monitor.method === 'HEARTBEAT'
        ? []
        : planIssues(monitor).map((issue) => `monitor "${monitor.id}": ${issue}`),
    );
    expect(issues).toEqual([]);
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

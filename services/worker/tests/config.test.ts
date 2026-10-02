import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vite-plus/test';
import { configIssues } from '@flarewatch/shared';
import { pageConfig } from '@flarewatch/config';
import { workerConfig } from '@flarewatch/config/worker';

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

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

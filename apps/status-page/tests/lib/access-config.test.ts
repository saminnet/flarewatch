import { describe, expect, it } from 'vite-plus/test';
import { accessConfigIssues } from '@flarewatch/shared';
import { pageConfig } from '@flarewatch/config';
import { accessConfig } from '@flarewatch/config/access';

describe('packages/config access', () => {
  it('is valid, so a broken sign-in config fails CI instead of deploying', () => {
    expect(accessConfigIssues(accessConfig, Object.keys(pageConfig.group ?? {}))).toEqual([]);
  });
});

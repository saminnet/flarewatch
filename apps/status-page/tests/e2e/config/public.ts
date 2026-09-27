import type { PageConfig } from '@flarewatch/shared';
import { pageConfig as demoPageConfig } from '../../../../../packages/config/src/public.ts';

// The Partner group holds only the private monitor from worker.ts, so visitors
// never see it. The id is spelled out: importing worker.ts here would put the
// monitor config in the browser bundle, since the page config ships there.
export const pageConfig: PageConfig = {
  ...demoPageConfig,
  group: { ...demoPageConfig.group, Partner: ['demo_private_internal'] },
};

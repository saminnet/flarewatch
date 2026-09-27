import type { PageConfig } from '@flarewatch/shared';
import { pageConfig as demoPageConfig } from '../../../../../packages/config/src/public.ts';

export const pageConfig: PageConfig = { ...demoPageConfig, visibility: 'private' };

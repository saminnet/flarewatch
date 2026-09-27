import type { PageConfig } from '@flarewatch/shared';
import { pageConfig as publicPageConfig } from './public.ts';

export const pageConfig: PageConfig = { ...publicPageConfig, visibility: 'private' };

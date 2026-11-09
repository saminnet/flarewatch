import type { PageConfig } from '@flarewatch/shared';

declare const __PAGE_TIMEZONE__: string | null;

/** Only the zone ships to the browser: the page config also names private monitors. */
export const pageZone: Pick<PageConfig, 'timezone'> = { timezone: __PAGE_TIMEZONE__ ?? undefined };

import { afterEach, beforeEach } from 'vite-plus/test';
import { forgetCachedView } from '@/lib/snapshots';

/** Starts and ends each test of the file with no hub view cached. */
export function forgetViewAroundEachTest(): void {
  beforeEach(() => forgetCachedView());
  afterEach(() => forgetCachedView());
}

import { afterEach, beforeEach } from 'vite-plus/test';
import { forgetCachedView } from '@/lib/snapshots';

export function forgetViewAroundEachTest(): void {
  beforeEach(() => forgetCachedView());
  afterEach(() => forgetCachedView());
}

import { afterEach, beforeEach } from 'vite-plus/test';
import { forgetCachedView } from '@/lib/hub-cache';

export function forgetViewAroundEachTest(): void {
  beforeEach(() => forgetCachedView());
  afterEach(() => forgetCachedView());
}

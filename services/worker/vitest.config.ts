import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite-plus/test/config';
import { commonTestOptions } from '@flarewatch/vitest-config';

export default defineConfig({
  cacheDir: '../../node_modules/.vite/worker',
  resolve: {
    alias: {
      'cloudflare:workers': path.resolve(
        import.meta.dirname,
        './tests/helpers/cloudflare-workers.ts',
      ),
      wrangler: path.resolve(import.meta.dirname, './tests/helpers/wrangler.ts'),
      '@flarewatch/unwrapped-wrangler': createRequire(import.meta.url).resolve('wrangler'),
    },
  },
  test: {
    ...commonTestOptions,
    include: ['tests/**/*.test.ts'],
  },
});

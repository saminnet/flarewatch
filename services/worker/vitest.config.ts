import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite-plus/test/config';

export default defineConfig({
  cacheDir: '../../node_modules/.vite/worker',
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '../../apps/status-page/src'),
      'cloudflare:workers': path.resolve(
        import.meta.dirname,
        './tests/helpers/cloudflare-workers.ts',
      ),
      wrangler: path.resolve(import.meta.dirname, './tests/helpers/wrangler.ts'),
      '@flarewatch/unwrapped-wrangler': createRequire(import.meta.url).resolve('wrangler'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['../../vitest.setup.ts'],
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});

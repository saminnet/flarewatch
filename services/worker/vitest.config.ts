import path from 'node:path';
import { defineConfig } from 'vite-plus/test/config';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': path.resolve(
        import.meta.dirname,
        './tests/helpers/cloudflare-workers.ts',
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['../../vitest.setup.ts'],
  },
});

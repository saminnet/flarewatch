import path from 'node:path';
import { defineConfig } from 'vite-plus/test/config';
import { commonTestOptions } from '@flarewatch/vitest-config';

export default defineConfig({
  plugins: [
    {
      // Exists only in workerd. Left external, the import fails at run time and
      // runtime-env.ts falls back to the test shim, as it does under node.
      name: 'external-cloudflare-workers',
      resolveId: (id) => (id === 'cloudflare:workers' ? { id, external: true } : null),
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    ...commonTestOptions,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: [...commonTestOptions.setupFiles, './tests/setup-ui.ts'],
  },
});

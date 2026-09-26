import path from 'node:path';
import { defineConfig } from 'vite-plus/test/config';

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
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['../../vitest.setup.ts'],
  },
});

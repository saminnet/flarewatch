import path from 'node:path';
import { defineConfig } from 'vite-plus/test/config';
import { commonTestOptions } from '@flarewatch/vitest-config';

const testConfig = path.resolve(import.meta.dirname, 'tests/config');

export default defineConfig({
  // Tests start on UTC whatever the config says. A test that needs a zone sets pageZone.
  define: { __PAGE_TIMEZONE__: 'null' },
  plugins: [
    {
      // Exists only in workerd. Left external, the import fails at run time and
      // runtime-env.ts falls back to the test shim, as it does under node.
      name: 'external-cloudflare-workers',
      resolveId: (id) => (id === 'cloudflare:workers' ? { id, external: true } : null),
    },
  ],
  // A fork edits its own config, so the tests read the upstream demo config instead.
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
      { find: /^@flarewatch\/config\/worker$/, replacement: '@flarewatch/config/demo/worker' },
      { find: /^@flarewatch\/config\/access$/, replacement: `${testConfig}/access.ts` },
      { find: /^@flarewatch\/config$/, replacement: '@flarewatch/config/demo/public' },
    ],
  },
  test: {
    ...commonTestOptions,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: [...commonTestOptions.setupFiles, './tests/setup-ui.ts'],
  },
});

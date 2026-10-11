import { defineConfig } from 'vite-plus/test/config';
import { commonTestOptions } from '@flarewatch/vitest-config';

export default defineConfig({
  test: {
    ...commonTestOptions,
    include: ['tests/**/*.test.ts'],
  },
});

import { defineConfig } from 'vite-plus/test/config';
import { commonTestOptions } from '../../vitest.common';

export default defineConfig({
  test: {
    ...commonTestOptions,
    include: ['tests/**/*.test.ts'],
  },
});

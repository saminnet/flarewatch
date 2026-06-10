import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: [
          'vp build',
          'node --experimental-strip-types scripts/seed-e2e-kv.ts',
          `vp exec wrangler dev --local --config dist/server/e2e-wrangler.json --env-file .wrangler/e2e.dev.vars --port ${port} --persist-to .wrangler/e2e-state`,
        ].join(' && '),
        url: baseURL,
        reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
        timeout: 180_000,
      },
  projects: [
    {
      name: 'chromium-public',
      grepInvert: /admin maintenance lifecycle/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-admin',
      grep: /admin maintenance lifecycle/,
      dependencies: ['chromium-public'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

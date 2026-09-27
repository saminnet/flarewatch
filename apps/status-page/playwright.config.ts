import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
// A second local instance, built with statusPage.visibility 'private'.
const privatePort = port + 1;
const privateBaseURL = `http://127.0.0.1:${privatePort}`;
// Build with the test config, copy the build aside, seed it, and serve it next to the monitoring worker.
const e2eServer = (variant: 'public' | 'private', listenPort: number) =>
  [
    `FLAREWATCH_E2E=${variant} vp build`,
    `FLAREWATCH_E2E=${variant} node --experimental-strip-types scripts/seed-e2e-kv.ts`,
    `vp exec wrangler dev --local --config .wrangler/e2e/${variant}/build/server/e2e-wrangler.json --config .wrangler/e2e/${variant}/worker-wrangler.json --env-file .wrangler/e2e.dev.vars --port ${listenPort} --persist-to .wrangler/e2e/${variant}/state`,
  ].join(' && ');

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
  // Playwright starts these in order, so the two builds never write dist at the same time.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : [
        {
          command: 'node --experimental-strip-types tests/e2e/fake-oidc.ts',
          url: 'http://127.0.0.1:3102/.well-known/openid-configuration',
          reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
        },
        {
          command: e2eServer('public', port),
          url: baseURL,
          reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
          timeout: 180_000,
        },
        {
          command: e2eServer('private', privatePort),
          url: `${privateBaseURL}/login`,
          reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === '1',
          timeout: 180_000,
        },
      ],
  projects: [
    {
      name: 'chromium-public',
      testIgnore: /private-only/,
      grepInvert: /operator maintenance lifecycle/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-operator',
      grep: /operator maintenance lifecycle/,
      dependencies: ['chromium-public'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-private',
      testMatch: /private-only/,
      use: { ...devices['Desktop Chrome'], baseURL: privateBaseURL },
    },
  ],
});

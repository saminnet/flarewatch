import { expect } from '@playwright/test';
import { test } from './fixtures';
import { captureLatencyCall } from './latency-call';

test.skip(
  Boolean(process.env.PLAYWRIGHT_BASE_URL),
  'needs the local seeded Wrangler server with its private monitor',
);

const ALLOWED = 'demo_cloudflare_docs';
const FORBIDDEN_IDS = ['demo_private_internal', 'demo_nightly_backup', 'missing_monitor'] as const;
const ALLOWED_ROW = /^Cloudflare Docs, operational, /;

test('gives a visitor the latency of a published monitor and nothing else', async ({ page }) => {
  const captured = await captureLatencyCall(page, ALLOWED, ALLOWED_ROW);
  const { cookie: _cookie, ...headers } = await captured.allHeaders();

  const read = async (monitorId: string) => {
    const response = await page.request.get(captured.url().replaceAll(ALLOWED, monitorId), {
      headers,
    });
    return { status: response.status(), body: await response.text() };
  };

  const allowed = await read(ALLOWED);
  expect(allowed.status).toBe(200);
  expect(allowed.body).toContain('AMS');

  for (const monitorId of FORBIDDEN_IDS) {
    const forbidden = await read(monitorId);
    expect(forbidden.status, monitorId).toBe(200);
    expect(forbidden.body, monitorId).toContain('"a":[]');
    expect(forbidden.body, monitorId).not.toContain('"loc"');
  }
});

test('serves a private monitor and its latency to a member', async ({ page }) => {
  const captured = await captureLatencyCall(page, ALLOWED, ALLOWED_ROW);
  const { cookie: _cookie, ...headers } = await captured.allHeaders();

  await page.goto('/login');
  await page.getByRole('link', { name: 'Continue with Test ID' }).click();
  await page.getByRole('link', { name: 'member@e2e.test' }).click();
  await expect(
    page.getByRole('button', { name: /Account menu, signed in as member/ }),
  ).toBeVisible();

  const response = await page.request.get(
    captured.url().replaceAll(ALLOWED, 'demo_private_internal'),
    { headers },
  );
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('FRA');

  await page.goto('/monitors/demo_private_internal');
  await expect(page.getByRole('heading', { level: 1, name: 'Internal Billing API' })).toBeVisible();
  await expect(page.getByTestId('latency-chart').first()).toBeVisible();
});

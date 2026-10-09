import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

// Static assets bypass the Worker, so they do not spend the request budget.
function trackServerCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (!pathname.startsWith('/assets/')) calls.push(`${request.method()} ${pathname}`);
  });
  return calls;
}

async function settle(page: Page, calls: string[]): Promise<void> {
  let seen = -1;
  while (seen !== calls.length) {
    seen = calls.length;
    await page.waitForTimeout(500);
  }
}

test('History hover and cached navigation add no server calls', async ({ page }) => {
  const calls = trackServerCalls(page);
  await page.goto('/');
  await settle(page, calls);
  expect(calls).toEqual(['GET /']);

  const history = page.getByRole('banner').getByRole('link', { name: 'History' });
  await history.hover();
  await page.waitForTimeout(800);
  expect(calls).toEqual(['GET /']);
  await history.click();
  await expect(page).toHaveURL(/\/history\?/);
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
  expect(calls).toEqual(['GET /']);

  await page
    .getByRole('banner')
    .getByRole('link', { name: /FlareWatch/ })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await history.click();
  await expect(page).toHaveURL(/\/history\?/);
  expect(calls).toEqual(['GET /']);
});

test('a cached monitor hover and navigation reuse its latency without server calls', async ({
  page,
}) => {
  const calls = trackServerCalls(page);
  await page.goto('/monitors/demo_cloudflare_docs');
  await expect(page.getByTestId('latency-chart').first()).toBeVisible();
  await settle(page, calls);
  expect(calls).toEqual(['GET /monitors/demo_cloudflare_docs']);

  await page.getByRole('link', { name: 'All monitors' }).click();
  await expect(page).toHaveURL(/\/$/);
  const docs = page.getByRole('link', { name: /^Cloudflare Docs, operational, / });
  await docs.hover();
  await page.waitForTimeout(800);
  expect(calls).toEqual(['GET /monitors/demo_cloudflare_docs']);
  await docs.click();
  await expect(page).toHaveURL(/\/monitors\/demo_cloudflare_docs$/);
  await expect(page.getByTestId('latency-chart').first()).toBeVisible();
  expect(calls).toEqual(['GET /monitors/demo_cloudflare_docs']);
});

test('hovering a monitor that was never opened adds no server call, and opening it loads its latency once', async ({
  page,
}) => {
  const calls = trackServerCalls(page);
  await page.goto('/');
  await settle(page, calls);
  expect(calls).toEqual(['GET /']);

  const docs = page.getByRole('link', { name: /^Cloudflare Docs, operational, / });
  await docs.hover();
  await page.waitForTimeout(800);
  expect(calls).toEqual(['GET /']);

  await docs.click();
  await expect(page).toHaveURL(/\/monitors\/demo_cloudflare_docs$/);
  await expect(page.getByTestId('latency-chart').first()).toBeVisible();
  await settle(page, calls);
  expect(calls.filter((call) => call.startsWith('GET /_serverFn/'))).toHaveLength(1);
  expect(calls).toHaveLength(2);
});

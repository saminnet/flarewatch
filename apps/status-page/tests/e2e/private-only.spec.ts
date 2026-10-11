import { createHmac } from 'node:crypto';
import { expect, request as playwrightRequest, type Page, type Request } from '@playwright/test';
import { test } from './fixtures';
import { captureLatencyCall } from './latency-call';

test.skip(
  Boolean(process.env.PLAYWRIGHT_BASE_URL),
  'private-only tests need the second local instance seeded as private',
);

const publishedNames = ['Example Domain', 'Nightly Backup', 'Websites', 'E2E active maintenance'];

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await expect(async () => {
    await page.getByLabel('Username').fill('e2e-admin');
    await page.getByLabel('Password').fill('e2e-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 2000 });
  }).toPass({ timeout: 15_000 });
}

test('visitors of a private page get the sign-in page and nothing else', async ({ request }) => {
  for (const path of [
    '/',
    '/history',
    '/monitors/demo_example',
    '/embed/demo_example',
    '/feed.atom',
    '/nope',
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(302);
    expect(response.headers().location, path).toMatch(/\/login$/);
  }

  for (const path of [
    '/api/data',
    '/api/maintenances',
    '/api/badge?id=demo_example',
    '/api/badge.svg?id=demo_example',
  ]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }

  const login = await request.get('/login');
  await expect(login).toBeOK();
  const html = await login.text();
  expect(html).toContain('This status page is private.');
  for (const name of publishedNames) expect(html).not.toContain(name);

  // Jobs keep reporting in while the page is private.
  const ping = await request.get('/ping/demo_nightly_backup/not-a-token', { maxRedirects: 0 });
  expect(ping.status()).not.toBe(302);
});

test('the operator signs in to the full page and signs out to the sign-in page', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Go back' })).toHaveCount(0);

  await signIn(page);
  await expect(page.getByRole('link', { name: /^Example Domain, operational, / })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Internal Billing API, / })).toBeVisible();

  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('This status page is private.')).toBeVisible();
});

async function replay(
  captured: Request,
  baseURL: string | undefined,
  withCookie: boolean,
): Promise<string> {
  const { cookie, ...headers } = await captured.allHeaders();
  const context = await playwrightRequest.newContext({ baseURL });
  try {
    const response = await context.get(captured.url(), {
      headers: withCookie && cookie ? { ...headers, cookie } : headers,
    });
    return await response.text();
  } finally {
    await context.dispose();
  }
}

test('the visitor data call refuses anyone but the operator', async ({ page, baseURL }) => {
  await signIn(page);

  // The Visitor view fetches the visitor snapshot through its server function.
  const call = page.waitForRequest((request) => request.url().includes('/_serverFn/'));
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Visitor view' }).click();
  const captured = await call;

  expect(await replay(captured, baseURL, true)).toContain('Example Domain');
  const anonymous = await replay(captured, baseURL, false);
  for (const name of publishedNames) expect(anonymous).not.toContain(name);
});

test('the latency call serves the operator and refuses visitors', async ({ page, baseURL }) => {
  await signIn(page);

  const captured = await captureLatencyCall(page, 'demo_example', /^Example Domain, operational, /);

  expect(await replay(captured, baseURL, true)).toContain('HEL');
  const anonymous = await replay(captured, baseURL, false);
  expect(anonymous).not.toContain('"loc"');
  expect(anonymous).toContain('"a":[]');
});

/** A ping URL's token: base64url(HMAC-SHA256(secret, `v1:<id>`)), 32 characters. */
function pingToken(id: string): string {
  return createHmac('sha256', 'e2e-heartbeat-secret')
    .update(`v1:${id}`)
    .digest('base64url')
    .slice(0, 32);
}

// A ping changes the job's phase at the next check run, and the suite runs no cron,
// so the test reads the run a success ping adds to the history at once.
test('a job pings through the private page and the operator sees its run', async ({
  page,
  request,
}) => {
  const ping = `/ping/demo_private_backup/${pingToken('demo_private_backup')}`;
  await signIn(page);

  const start = await request.post(`${ping}/start`);
  expect([start.status(), await start.text()]).toEqual([200, 'OK']);
  const done = await request.get(ping);
  expect([done.status(), await done.text()]).toEqual([200, 'OK']);
  await expect(async () => {
    await page.goto('/');
    await expect(
      page.getByRole('link', { name: /^Internal Vault Backup, operational, .*last 2 runs/ }),
    ).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });

  expect((await request.get(`/ping/demo_private_backup/${'x'.repeat(32)}`)).status()).toBe(404);
});

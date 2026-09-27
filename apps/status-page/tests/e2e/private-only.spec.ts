import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';

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
  for (const path of ['/', '/history', '/monitors/demo_example', '/embed/demo_example', '/nope']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(302);
    expect(response.headers().location, path).toMatch(/\/login$/);
  }

  for (const path of ['/api/data', '/api/maintenances', '/api/badge?id=demo_example']) {
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

test('the visitor data call refuses anyone but the operator', async ({ page, baseURL }) => {
  await signIn(page);

  // The Visitor view fetches the visitor snapshot through its server function.
  const call = page.waitForRequest((request) => request.url().includes('/_serverFn/'));
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Visitor view' }).click();
  const captured = await call;
  const { cookie, ...headers } = await captured.allHeaders();

  const replay = async (withCookie: boolean) => {
    const context = await playwrightRequest.newContext({ baseURL });
    const response = await context.get(captured.url(), {
      headers: withCookie && cookie ? { ...headers, cookie } : headers,
    });
    const body = await response.text();
    await context.dispose();
    return body;
  };

  expect(await replay(true)).toContain('Example Domain');
  const anonymous = await replay(false);
  for (const name of publishedNames) expect(anonymous).not.toContain(name);
});

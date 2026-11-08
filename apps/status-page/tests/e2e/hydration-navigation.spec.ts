import { expect } from '@playwright/test';
import { test } from './fixtures';

const pages = [
  { from: '/', link: 'History', shows: 'History' },
  { from: '/history', shows: 'Monitors' },
  { from: '/monitors/demo_example', shows: 'Monitors' },
  { from: '/login', shows: 'Monitors' },
  { from: '/no-such-page', shows: 'Monitors', expectedError: 'status of 404' },
];

for (const { from, link, shows, expectedError } of pages) {
  test(`a header link clicked while ${from} hydrates opens the next page without errors`, async ({
    page,
    clientErrors,
  }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await page.goto(from);
    const header = page.getByRole('banner');
    await (
      link ? header.getByRole('link', { name: link }) : header.getByRole('link').first()
    ).click();
    await expect(page.getByRole('heading', { name: shows, exact: true })).toBeVisible();
    if (expectedError) {
      expect(clientErrors).toEqual([expect.stringContaining(expectedError)]);
      clientErrors.length = 0;
    }
  });
}

test('a username and password typed while /login loads its scripts still sign in', async ({
  page,
}) => {
  await page.route('**/assets/**/*.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.goto('/login', { waitUntil: 'commit' });
  await page.getByLabel('Username').fill('e2e-admin');
  await page.getByLabel('Password').fill('e2e-password');
  await page.getByRole('button', { name: 'Sign in' }).click({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/$/);
});

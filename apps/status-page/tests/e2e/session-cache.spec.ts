import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    recordPrivateDisclosure: (text: string) => Promise<void>;
  }
}

test('an open tab forgets the previous account when another one signs in', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Continue with Test ID' }).click();
  await page.getByRole('link', { name: 'operator@e2e.test' }).click();
  await expect(page.getByRole('heading', { name: 'Internal Billing API' })).toBeVisible();
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Visitor view' }).click();
  await expect(page.getByRole('link', { name: 'Exit visitor view' })).toBeVisible();

  const disclosed: string[] = [];
  await page.exposeFunction('recordPrivateDisclosure', (text: string) => disclosed.push(text));
  await page.evaluate(() => {
    new MutationObserver(() => {
      if (document.body.textContent?.includes('Internal Billing API')) {
        void window.recordPrivateDisclosure('Internal Billing API');
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  const other = await context.newPage();
  await other.goto('/');
  await other.getByRole('button', { name: /Account menu/ }).click();
  await other.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(other.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await other.goto('/login');
  await other.getByRole('link', { name: 'Continue with Test ID' }).click();
  await other.getByRole('link', { name: 'partner@e2e.test' }).click();
  await expect(other.getByRole('button', { name: /Account menu/ })).toHaveAttribute(
    'aria-label',
    /partner/,
  );

  await page.bringToFront();
  await expect(page.getByRole('button', { name: /Account menu/ })).toHaveAttribute(
    'aria-label',
    /partner/,
  );
  await expect(page.getByRole('link', { name: 'Exit visitor view' })).toHaveCount(0);
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(/\/history/);
  expect(disclosed).toEqual([]);
});

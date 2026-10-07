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
  await page.getByRole('link', { name: 'member@e2e.test' }).click();
  await expect(page.getByRole('heading', { name: 'Internal Vault Backup' })).toBeVisible();
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Visitor view' }).click();
  await expect(page.getByRole('link', { name: 'Exit visitor view' })).toBeVisible();

  const disclosed: string[] = [];
  await page.exposeFunction('recordPrivateDisclosure', (text: string) => disclosed.push(text));
  const watch = () => {
    new MutationObserver(() => {
      if (document.documentElement.textContent?.includes('Internal Vault Backup')) {
        void window.recordPrivateDisclosure('Internal Vault Backup');
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  };
  await page.addInitScript(watch);
  await page.evaluate(watch);

  const other = await context.newPage();
  await other.goto('/auth/test-id');
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
  await page.getByRole('link', { name: 'Exit visitor view' }).click();
  await expect(page).not.toHaveURL(/view=visitor/);
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(/\/history/);
  expect(disclosed).toEqual([]);
});

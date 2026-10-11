import type { Page } from '@playwright/test';

export async function signInAs(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Continue with Test ID' }).click();
  await page.getByRole('link', { name: email }).click();
}

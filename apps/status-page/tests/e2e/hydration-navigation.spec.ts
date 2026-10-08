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

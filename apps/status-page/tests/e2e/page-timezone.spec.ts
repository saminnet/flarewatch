import { expect } from '@playwright/test';
import { test } from './fixtures';

test.use({ timezoneId: 'America/Los_Angeles' });

test('the configured page time survives hydration in a different visitor zone', async ({
  page,
}) => {
  let releaseScripts: () => void = () => undefined;
  const scripts = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await page.route('**/assets/**/*.js', async (route) => {
    await scripts;
    await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    const time = page.locator('time[datetime]').first();
    const datetime = await time.getAttribute('datetime');
    if (!datetime) throw new Error('Displayed time has no datetime');
    const local = new Date(Date.parse(datetime) + 570 * 60_000);
    const month = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ][local.getUTCMonth()];
    const expected = `${month} ${local.getUTCDate()}, ${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')} UTC+9:30`;
    await expect(time).toHaveText(expected);
    releaseScripts();
    await expect(page.getByText(/^Last updated .*\(\d+s ago\)$/)).toBeVisible();
    await expect(time).toHaveText(expected);
  } finally {
    releaseScripts();
  }
});

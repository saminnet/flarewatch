import { expect } from '@playwright/test';
import { test } from './fixtures';

/** The width one mobile run cell takes: `w-2.5` plus the `gap-0.5` between cells. */
const MOBILE_CELL_PX = 12;

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 720 },
]) {
  test(`run history wraps arrow keys and supports Home and End at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/monitors/demo_nightly_compactor');
    const strip = page.getByRole('group', { name: /90 runs, 1 missed, 1 failed, last run/ });
    const cells = strip.getByRole('button');
    const next = page.getByRole('button', { name: /^Next run/ });
    await expect(cells.first()).toBeVisible();

    // SSR renders the group before hydration attaches its keyboard handler.
    await expect(async () => {
      await strip.focus();
      await strip.press('ArrowRight');
      await expect(cells.first()).toBeFocused({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await cells.first().press('ArrowLeft');
    await expect(next).toBeFocused();
    await next.press('ArrowRight');
    await expect(cells.first()).toBeFocused();
    await cells.first().press('ArrowRight');
    await expect(cells.nth(1)).toBeFocused();
    await cells.nth(1).press('ArrowLeft');
    await expect(cells.first()).toBeFocused();
    await cells.first().press('End');
    await expect(next).toBeFocused();
    await next.press('ArrowLeft');
    await expect(cells.last()).toBeFocused();
    await cells.last().press('ArrowRight');
    await expect(next).toBeFocused();
    await next.press('Home');
    await expect(cells.first()).toBeFocused();
  });
}

test('a full heartbeat history fills one measured strip on a phone, without duplicated runs', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/monitors/demo_nightly_compactor');

  const strip = page.getByRole('group', { name: /90 runs, 1 missed, 1 failed, last run/ });
  await expect(strip).toBeVisible();

  // Cells render only after hydration measures the container.
  const cells = strip.getByRole('button');
  await expect(cells.first()).toBeVisible();
  const width = (await strip.boundingBox())?.width ?? 0;
  await expect(cells).toHaveCount(Math.min(Math.floor(width / MOBILE_CELL_PX), 90));

  // The desktop copy is display:none, so the latest failed run is reachable exactly once.
  await expect(page.getByRole('button', { name: /^Failed at/ })).toBeVisible();
});

test('an empty heartbeat strip and its waiting cell show once at every viewport size', async ({
  page,
}) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/monitors/demo_weekly_prune');

    await expect(
      page.getByRole('group', { name: 'No run recorded yet. The first ping starts the schedule.' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Waiting for the first ping' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Completed|Failed|Missed) at/ })).toHaveCount(
      0,
    );
  }
});

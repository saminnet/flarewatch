import { expect, test } from '@playwright/test';
import { collectClientErrors } from './client-errors';

/** The width one mobile run cell takes: `w-2.5` plus the `gap-0.5` between cells. */
const MOBILE_CELL_PX = 12;

test('a full heartbeat history fills one measured strip on a phone, without duplicated runs', async ({
  page,
}) => {
  const clientErrors = collectClientErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/monitors/demo_nightly_compactor');

  const strip = page.getByRole('group', { name: /90 runs, 1 missed, 1 failed, last run/ });
  await expect(strip).toBeVisible();

  // Hydration measures the container and renders the newest cells; before that there are none.
  const cells = strip.getByRole('button');
  await expect(cells.first()).toBeVisible();
  const width = (await strip.boundingBox())?.width ?? 0;
  await expect(cells).toHaveCount(Math.min(Math.floor(width / MOBILE_CELL_PX), 90));

  // The desktop copy is display:none, so the latest failed run is reachable exactly once.
  await expect(page.getByRole('button', { name: /^Failed at/ })).toBeVisible();

  expect(clientErrors).toEqual([]);
});

test('an empty heartbeat strip and its waiting cell show once at every viewport size', async ({
  page,
}) => {
  const clientErrors = collectClientErrors(page);

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

  expect(clientErrors).toEqual([]);
});

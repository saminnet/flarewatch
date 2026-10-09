import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';

const STATUS_TOKENS = [
  'status-degraded',
  'status-degraded-bg',
  'status-degraded-border',
  'status-degraded-text',
  'status-down',
  'status-down-bg',
  'status-down-border',
  'status-down-text',
  'status-maintenance',
  'status-maintenance-bg',
  'status-maintenance-border',
  'status-operational',
  'status-operational-bg',
  'status-operational-border',
  'status-unknown',
  'status-unknown-bg',
  'status-unknown-border',
] as const;

async function statusColors(page: Page): Promise<Record<string, string>> {
  return page.evaluate(
    (tokens: string[]) => {
      const probe = document.createElement('div');
      document.body.appendChild(probe);
      probe.style.color = 'unset';
      const fallback = getComputedStyle(probe).color;
      const colors: Record<string, string> = {};
      for (const token of tokens) {
        probe.style.color = `var(--${token})`;
        const color = getComputedStyle(probe).color;
        colors[token] = color === fallback ? 'unset' : color;
      }
      probe.remove();
      return colors;
    },
    [...STATUS_TOKENS],
  );
}

function resolve(page: Page, property: string, value: string): Promise<string> {
  return page.evaluate(
    ([property, value]) => {
      const probe = document.body.appendChild(document.createElement('div'));
      probe.style.setProperty(property, value);
      const resolved = getComputedStyle(probe).getPropertyValue(property);
      probe.remove();
      return resolved;
    },
    [property, value] as const,
  );
}

test('status colors resolve in light and dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const light = await statusColors(page);

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const dark = await statusColors(page);

  for (const token of STATUS_TOKENS) {
    expect(light[token], `light ${token}`).not.toBe('unset');
    expect(dark[token], `dark ${token}`).not.toBe('unset');
  }
  for (const token of STATUS_TOKENS.filter((name) => name.endsWith('-bg'))) {
    expect(dark[token], `dark ${token}`).not.toBe(light[token]);
  }
});

test('status color utilities paint elements with their token', async ({ page }) => {
  await page.goto('/monitors/demo_nightly_compactor');
  const cell = page.getByRole('button', { name: /^Completed at/ }).first();
  await expect(cell).toBeVisible();
  expect(await cell.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    await resolve(page, 'background-color', 'var(--status-operational)'),
  );

  await page.goto('/monitors/demo_log_shipper');
  const badge = page.locator('[data-slot="card"] [data-slot="badge"]').first();
  await expect(badge).toBeVisible();
  expect(await badge.evaluate((el) => getComputedStyle(el).color)).toBe(
    await resolve(page, 'color', 'var(--status-down-text)'),
  );
  expect(await badge.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(
    await resolve(page, 'border-top-color', 'var(--status-down)'),
  );
});

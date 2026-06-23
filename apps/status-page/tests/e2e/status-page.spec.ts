import { Buffer } from 'node:buffer';
import { expect, test, type APIResponse, type Page } from '@playwright/test';

type SeededMonitor = {
  id: string;
  name: string;
  status: 'operational' | 'not operational';
  latency?: string;
  error?: string;
  href?: string;
};

type PublicData = {
  up: number;
  down: number;
  monitors: Record<string, { up: boolean; latency: number | null }>;
};

const seededMonitors: SeededMonitor[] = [
  {
    id: 'demo_example',
    name: 'Example Domain',
    status: 'operational',
    latency: '74ms',
  },
  {
    id: 'demo_cloudflare_trace',
    name: 'Cloudflare Trace',
    status: 'operational',
  },
  {
    id: 'demo_cloudflare_status',
    name: 'Cloudflare Status API',
    status: 'not operational',
    latency: '242ms',
    error: 'Synthetic E2E outage',
    href: 'https://www.cloudflarestatus.com',
  },
] as const;

const adminCredentials = {
  username: 'e2e-admin',
  password: 'e2e-password',
};
const adminAuthHeaders = {
  Authorization: `Basic ${Buffer.from(
    `${adminCredentials.username}:${adminCredentials.password}`,
  ).toString('base64')}`,
};
const HOUR_MS = 60 * 60 * 1000;

function collectClientErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function readOkJson<T = unknown>(response: APIResponse): Promise<T> {
  await expect(response).toBeOK();
  return (await response.json()) as T;
}

function getPublicMonitor(data: PublicData, monitorId: string): PublicData['monitors'][string] {
  const monitor = data.monitors[monitorId];
  expect(monitor).toBeDefined();
  return monitor!;
}

test('seeded dashboard matches monitor data and supports collapse interactions', async ({
  page,
  request,
}) => {
  const clientErrors = collectClientErrors(page);
  const dataResponse = await request.get('/api/data');
  const data = await readOkJson<PublicData>(dataResponse);

  await page.goto('/');

  await expect(page).toHaveTitle(/FlareWatch/);
  await expect(page.getByRole('banner').getByRole('link', { name: /FlareWatch/ })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Some systems are down \(1 out of 3\)/i }),
  ).toBeVisible();
  await expect(page.getByText('2 up / 1 down')).toBeVisible();
  expect(data.up).toBe(2);
  expect(data.down).toBe(1);

  await expect(page.getByRole('button', { name: 'Toggle Demo (3 monitors)' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByText('E2E active maintenance')).toBeVisible();
  await expect(page.getByText('E2E upcoming maintenance')).toBeVisible();

  for (const monitor of seededMonitors) {
    expect(getPublicMonitor(data, monitor.id).up).toBe(monitor.status === 'operational');
    await expect(
      page.getByRole('button', {
        name: new RegExp(`${monitor.name}, ${monitor.status}.*Click to toggle details`),
      }),
    ).toBeVisible();
    if (monitor.latency) {
      await expect(page.getByText(monitor.latency).filter({ visible: true }).first()).toBeVisible();
    }
    if (monitor.error) await expect(page.getByText(monitor.error)).toBeVisible();
    if (monitor.href) {
      await expect(page.getByRole('link', { name: new RegExp(monitor.name) })).toHaveAttribute(
        'href',
        monitor.href,
      );
    }
  }

  await expect(page.getByRole('heading', { name: 'Response times (ms)' }).first()).toBeVisible();
  await expect(page.getByTestId('latency-chart').first()).toBeVisible();

  await page.getByRole('button', { name: 'Toggle Demo (3 monitors)' }).click();
  await expect(page.getByRole('button', { name: 'Toggle Demo (3 monitors)' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByRole('button', { name: /Example Domain, operational/ })).not.toBeVisible();

  await page.getByRole('button', { name: 'Toggle Demo (3 monitors)' }).click();
  await expect(page.getByRole('button', { name: /Example Domain, operational/ })).toBeVisible();
  expect(clientErrors).toEqual([]);
});

test('latency chart is server-rendered, labeled, and supports hover', async ({ page, request }) => {
  // SSR: the chart container and its SVG line/grid are in the raw server HTML, before any JS.
  const html = await (await request.get('/')).text();
  expect(html).toContain('data-testid="latency-chart"');
  expect(html).toContain('vector-effect="non-scaling-stroke"');

  await page.goto('/');
  const chart = page.getByTestId('latency-chart').first();
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toBeVisible();

  // Exposed to assistive tech as a single labeled graphic.
  await expect(
    page.getByRole('img', { name: /Response time chart, latest \d+ms from/ }).first(),
  ).toBeVisible();

  // The line path and a y-axis label render from real data.
  await expect(chart.locator('path').first()).toBeVisible();
  await expect(chart.getByText(/^\d+ms$/).first()).toBeVisible();

  // Hovering reveals the tooltip; its "MMM d, HH:mm" line is unique to the tooltip.
  await chart.hover();
  await expect(chart.getByText(/\w{3} \d{1,2}, \d{1,2}:\d{2}/)).toBeVisible();
});

test('shows the chart empty state for a monitor with no latency data', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('No response data yet')).toBeVisible();
});

test.describe('latency chart touch', () => {
  test.use({ hasTouch: true });
  test('tooltip appears on touch press and clears on lift', async ({ page }) => {
    await page.goto('/');
    const chart = page.getByTestId('latency-chart').first();
    await chart.scrollIntoViewIfNeeded();
    await chart.waitFor({ state: 'visible' });

    const box = (await chart.boundingBox())!;
    const at = {
      clientX: box.x + box.width * 0.55,
      clientY: box.y + box.height * 0.5,
      pointerType: 'touch',
      isPrimary: true,
      pointerId: 1,
      bubbles: true,
    };
    const dot = chart.locator('span.rounded-full');

    await chart.dispatchEvent('pointerdown', at);
    await expect(dot).toBeVisible();
    await chart.dispatchEvent('pointerup', at);
    await expect(dot).toHaveCount(0);
  });
});

test('public API exposes seeded status, maintenance, badges, and CORS', async ({ request }) => {
  const dataResponse = await request.get('/api/data', {
    headers: { Origin: 'https://example.test' },
  });
  const data = await readOkJson<PublicData>(dataResponse);
  expect(dataResponse.headers()['access-control-allow-origin']).toBe('*');

  expect(data).toMatchObject({
    up: 2,
    down: 1,
    monitors: {
      demo_example: {
        up: true,
        location: 'HEL',
        message: 'OK',
      },
      demo_cloudflare_status: {
        up: false,
        location: 'SFO',
        message: 'Synthetic E2E outage',
      },
    },
  });
  expect(getPublicMonitor(data, 'demo_example').latency).toEqual(expect.any(Number));
  // demo_cloudflare_trace has no recent latency, so the API reports null.
  expect(getPublicMonitor(data, 'demo_cloudflare_trace').latency).toBeNull();

  const maintenancesResponse = await request.get('/api/maintenances');
  const maintenances = await readOkJson<{ title?: string }[]>(maintenancesResponse);
  expect(maintenances.map((maintenance: { title?: string }) => maintenance.title)).toEqual(
    expect.arrayContaining(['E2E active maintenance', 'E2E upcoming maintenance']),
  );

  const badgeResponse = await request.get('/api/badge?id=demo_cloudflare_status');
  await expect(badgeResponse).toBeOK();
  expect(badgeResponse.headers()['cache-control']).toContain('no-store');
  expect(await badgeResponse.json()).toMatchObject({
    schemaVersion: 1,
    label: 'demo_cloudflare_status',
    message: 'DOWN',
    color: 'red',
  });

  const unknownBadgeResponse = await request.get('/api/badge?id=missing_monitor');
  expect(unknownBadgeResponse.status()).toBe(404);
  expect(await unknownBadgeResponse.json()).toMatchObject({
    isError: true,
    message: 'unknown',
  });

  const optionsResponse = await request.fetch('/api/data', {
    method: 'OPTIONS',
    headers: { Origin: 'https://example.test' },
  });
  expect(optionsResponse.status()).toBe(204);
  expect(optionsResponse.headers()['access-control-allow-origin']).toBe('*');
  expect(optionsResponse.headers()['access-control-allow-methods']).toContain('GET');

  const unauthorizedAdminResponse = await request.get('/api/admin/maintenances');
  expect(unauthorizedAdminResponse.status()).toBe(401);

  const forbiddenCrossOriginWrite = await request.post('/api/admin/maintenances', {
    headers: {
      ...adminAuthHeaders,
      Origin: 'https://malicious.example',
    },
    data: {
      body: 'Cross-origin write should not be accepted.',
      start: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  });
  expect(forbiddenCrossOriginWrite.status()).toBe(403);
});

test('events route renders seeded incidents and maintenance', async ({ page }) => {
  const clientErrors = collectClientErrors(page);
  await page.goto('/events');

  await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
  await expect(page.getByText('Incidents and scheduled maintenance')).toBeVisible();
  await expect(page.getByText('Active & Upcoming Maintenance')).toBeVisible();
  await expect(page.getByText('E2E active maintenance')).toBeVisible();
  await expect(page.getByText('Cloudflare Status API')).toBeVisible();
  await expect(page.locator('[data-slot="badge"]').filter({ hasText: /^Incident$/ })).toHaveCount(
    1,
  );
  await expect(page.locator('[data-slot="badge"]').filter({ hasText: /^Ongoing$/ })).toHaveCount(2);
  await expect(page.getByText('Synthetic E2E outage')).toBeVisible();
  expect(clientErrors).toEqual([]);
});

test('events route filters by type, monitor, and invalid month fallback', async ({ page }) => {
  await page.goto('/events?type=incident');
  await expect(page).toHaveURL(/type=incident/);
  await expect(page.getByText('Synthetic E2E outage')).toBeVisible();
  await expect(page.getByText('E2E active maintenance')).not.toBeVisible();

  await page.goto('/events?type=maintenance');
  await expect(page).toHaveURL(/type=maintenance/);
  await expect(page.getByText('E2E active maintenance')).toBeVisible();
  await expect(page.getByText('E2E upcoming maintenance')).toBeVisible();
  await expect(page.getByText('Synthetic E2E outage')).not.toBeVisible();

  await page.goto('/events?monitor=demo_example');
  await expect(page).toHaveURL(/monitor=demo_example/);
  await expect(page.getByText('E2E upcoming maintenance')).toBeVisible();
  await expect(page.getByText('Synthetic E2E outage')).not.toBeVisible();

  await page.goto('/events?month=not-a-month');
  await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
  await expect(page.getByText('Incidents and scheduled maintenance')).toBeVisible();
  await expect(page).not.toHaveURL(/not-a-month/);
});

test('embed route renders seeded monitor status and variants', async ({ page }) => {
  const clientErrors = collectClientErrors(page);
  await page.goto('/embed/demo_example');

  await expect(page.getByText('Example Domain')).toBeVisible();
  await expect(page.getByText('74ms (edge HEL)')).toBeVisible();

  await page.goto('/embed/demo_cloudflare_status?theme=dark');
  await expect(page.getByText('Cloudflare Status API')).toBeVisible();
  await expect(page.getByText('Synthetic E2E outage')).toBeVisible();
  await expect(page.locator('.dark')).toBeVisible();

  await page.goto('/embed/demo_cloudflare_status?minimal=true');
  await expect(page.getByText(/99\./)).toBeVisible();
  await expect(page.getByText('Cloudflare Status API')).not.toBeVisible();

  await page.goto('/embed/missing_monitor');
  await expect(page.getByText('Monitor with ID missing_monitor not found.')).toBeVisible();
  expect(clientErrors).toEqual([]);
});

test.describe.serial('admin maintenance lifecycle', () => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    'mutating admin E2E tests require the local seeded Wrangler server',
  );

  test('signs in, writes maintenance records, and exposes changes publicly', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Admin sign-in' })).toBeVisible();

    await page.evaluate(async (credentials) => {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(credentials),
      });
      if (!response.ok) {
        throw new Error(`Admin sign-in failed with ${response.status}`);
      }
    }, adminCredentials);

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
    await expect(page.getByText('Manage scheduled maintenance windows')).toBeVisible();

    const adminRequest = page.context().request;
    const now = Date.now();
    const createdResponse = await adminRequest.post('/api/admin/maintenances', {
      headers: adminAuthHeaders,
      data: {
        title: 'E2E lifecycle maintenance',
        body: 'Created through the authenticated admin E2E flow.',
        monitors: ['demo_example'],
        start: new Date(now + 2 * HOUR_MS).toISOString(),
        end: new Date(now + 3 * HOUR_MS).toISOString(),
        color: 'blue',
      },
    });
    expect(createdResponse.status()).toBe(201);
    const created = await createdResponse.json();

    await page.reload();
    await expect(page.getByText('E2E lifecycle maintenance')).toBeVisible();

    const updatedResponse = await adminRequest.put('/api/admin/maintenances', {
      headers: adminAuthHeaders,
      data: {
        id: created.id,
        updates: {
          title: 'E2E lifecycle maintenance updated',
          body: 'Updated through the authenticated admin E2E flow.',
          monitors: ['demo_cloudflare_trace'],
          start: created.start,
          end: created.end,
          color: 'yellow',
        },
      },
    });
    await expect(updatedResponse).toBeOK();

    await page.reload();
    await expect(page.getByText('E2E lifecycle maintenance updated')).toBeVisible();
    await expect(page.getByText('Cloudflare Trace').first()).toBeVisible();

    const publicMaintenancesResponse = await adminRequest.get('/api/maintenances');
    const publicMaintenances = await readOkJson<{ id: string; title?: string }[]>(
      publicMaintenancesResponse,
    );
    expect(
      publicMaintenances.some(
        (maintenance: { id: string; title?: string }) =>
          maintenance.id === created.id &&
          maintenance.title === 'E2E lifecycle maintenance updated',
      ),
    ).toBe(true);

    const deletedResponse = await adminRequest.delete('/api/admin/maintenances', {
      headers: adminAuthHeaders,
      data: { id: created.id },
    });
    expect(deletedResponse.status()).toBe(204);

    await page.reload();
    await expect(page.getByText('E2E lifecycle maintenance updated')).not.toBeVisible();
  });
});

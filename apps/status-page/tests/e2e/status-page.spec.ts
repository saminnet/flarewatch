import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { isJsonObject, isValidMaintenance } from '@flarewatch/shared';

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
  {
    id: 'demo_cloudflare_docs',
    name: 'Cloudflare Docs',
    status: 'operational',
    latency: '60ms',
    href: 'https://developers.cloudflare.com/',
  },
  {
    id: 'demo_one_dns_trace',
    name: '1.1.1.1 Trace',
    status: 'operational',
    latency: '44ms',
  },
  {
    id: 'demo_github_status',
    name: 'GitHub Status API',
    status: 'operational',
    latency: '127ms',
    href: 'https://www.githubstatus.com',
  },
] as const;

const adminCredentials = {
  username: 'e2e-admin',
  password: 'e2e-password',
};
const adminAuthHeaders = {
  Authorization: `Basic ${btoa(`${adminCredentials.username}:${adminCredentials.password}`)}`,
};
const HOUR_MS = 60 * 60 * 1000;
const privateMonitorFields = [
  'checkProxy',
  'expectedCodes',
  'responseKeyword',
  '"headers"',
  '"body"',
] as const;

function expectNoPrivateMonitorFields(body: string): void {
  for (const field of privateMonitorFields) expect(body).not.toContain(field);
}

function collectClientErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function readOkJson<T>(
  response: APIResponse,
  guard: (value: unknown) => value is T,
): Promise<T> {
  await expect(response).toBeOK();
  const json: unknown = await response.json();
  if (!guard(json)) throw new Error(`Unexpected response shape from ${response.url()}`);
  return json;
}

function isPublicData(value: unknown): value is PublicData {
  if (!isJsonObject(value)) return false;
  if (typeof value.up !== 'number' || typeof value.down !== 'number') return false;
  if (!isJsonObject(value.monitors)) return false;
  return Object.values(value.monitors).every(
    (monitor) =>
      isJsonObject(monitor) &&
      typeof monitor.up === 'boolean' &&
      (monitor.latency === null || typeof monitor.latency === 'number'),
  );
}

type PublicMaintenance = { id?: string; title?: string; start?: string };

function isMaintenanceList(value: unknown): value is PublicMaintenance[] {
  return Array.isArray(value) && value.every((item) => isJsonObject(item));
}

function isSeededMaintenanceList(
  value: unknown,
): value is (PublicMaintenance & { start: string })[] {
  return isMaintenanceList(value) && value.every((item) => typeof item.start === 'string');
}

function getPublicMonitor(data: PublicData, monitorId: string): PublicData['monitors'][string] {
  const monitor = data.monitors[monitorId];
  if (monitor === undefined) throw new Error(`Monitor ${monitorId} missing from public data`);
  return monitor;
}

test('seeded dashboard matches monitor data and supports collapse interactions', async ({
  page,
  request,
}) => {
  const clientErrors = collectClientErrors(page);
  const dataResponse = await request.get('/api/data');
  const data = await readOkJson(dataResponse, isPublicData);

  await page.goto('/');

  await expect(page).toHaveTitle(/FlareWatch/);
  await expect(page.getByRole('banner').getByRole('link', { name: /FlareWatch/ })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Some systems are down \(3 out of 12\)/i }),
  ).toBeVisible();
  await expect(page.getByText('8 up / 1 late / 3 down')).toBeVisible();
  expect(data.up).toBe(9);
  expect(data.down).toBe(3);

  for (const groupToggle of [
    'Toggle Websites (2 monitors)',
    'Toggle APIs (2 monitors)',
    'Toggle Status Feeds (2 monitors)',
    'Toggle Scheduled jobs (6 jobs)',
  ]) {
    await expect(page.getByRole('button', { name: groupToggle })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  }
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

  await page.getByRole('button', { name: 'Toggle Websites (2 monitors)' }).click();
  await expect(page.getByRole('button', { name: 'Toggle Websites (2 monitors)' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByRole('button', { name: /Example Domain, operational/ })).not.toBeVisible();

  await page.getByRole('button', { name: 'Toggle Websites (2 monitors)' }).click();
  await expect(page.getByRole('button', { name: /Example Domain, operational/ })).toBeVisible();
  expect(clientErrors).toEqual([]);
});

test('latency chart is server-rendered, labeled, and supports hover', async ({ page, request }) => {
  // SSR: the chart container and its SVG line/grid are in the raw server HTML, before any JS.
  const html = await (await request.get('/')).text();
  expectNoPrivateMonitorFields(html);
  expect(html).toContain('data-testid="latency-chart"');
  expect(html).toContain('vector-effect="non-scaling-stroke"');
  expect(html).toMatch(/fill="url\(#chart-fill-/);
  expect(html).toContain('stop-opacity="var(--chart-fill-top)"');

  await page.goto('/');
  const chart = page.getByTestId('latency-chart').first();
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toBeVisible();

  // Exposed to assistive tech as a single labeled graphic.
  await expect(
    page.getByRole('img', { name: /Response time chart, latest \d+ms from/ }).first(),
  ).toBeVisible();

  await expect(chart.locator('path').first()).toBeVisible();
  await expect(chart.getByText(/^\d+ms$/).first()).toBeVisible();

  // Hovering reveals the tooltip; its "MMM d, HH:mm" line is unique to the tooltip.
  // The pointer handler only exists after hydration, and a mousemove that lands
  // before it never re-fires — retry from a neutral position until it sticks.
  await expect(async () => {
    await page.mouse.move(0, 0);
    await chart.hover();
    await expect(chart.getByText(/\w{3} \d{1,2}, \d{1,2}:\d{2}/)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
});

test('empty chart state renders in the trace card', async ({ page }) => {
  await page.goto('/');
  await expect(
    monitorCard(page, 'Cloudflare Trace').getByText('No response data yet'),
  ).toBeVisible();
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

    // Same hydration race as the hover test: a pointerdown dispatched before
    // the handler attaches is lost, so retry until the tooltip dot appears.
    await expect(async () => {
      await chart.dispatchEvent('pointerdown', at);
      await expect(dot).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await chart.dispatchEvent('pointerup', at);
    await expect(dot).toHaveCount(0);
  });
});

test('public API exposes seeded status, maintenance, badges, and CORS', async ({ request }) => {
  const dataResponse = await request.get('/api/data', {
    headers: { Origin: 'https://example.test' },
  });
  const data = await readOkJson(dataResponse, isPublicData);
  expectNoPrivateMonitorFields(JSON.stringify(data));
  expect(dataResponse.headers()['access-control-allow-origin']).toBe('*');

  expect(data).toMatchObject({
    up: 9,
    down: 3,
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
  const maintenances = await readOkJson(maintenancesResponse, isMaintenanceList);
  expect(maintenances.map((maintenance) => maintenance.title)).toEqual(
    expect.arrayContaining(['E2E active maintenance', 'E2E upcoming maintenance']),
  );

  const badgeResponse = await request.get('/api/badge?id=demo_cloudflare_status');
  await expect(badgeResponse).toBeOK();
  expect(badgeResponse.headers()['cache-control']).toContain('no-store');
  const badgeBody = await badgeResponse.text();
  expectNoPrivateMonitorFields(badgeBody);
  expect(JSON.parse(badgeBody)).toMatchObject({
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

const privateMonitor = {
  id: 'demo_private_internal',
  name: 'Internal Billing API',
  maintenance: 'E2E private maintenance',
} as const;

const privateHeartbeat = {
  id: 'demo_private_backup',
  name: 'Internal Vault Backup',
} as const;

const UTC_STAMP = String.raw`\w{3} \d{1,2}, \d{2}:\d{2} UTC`;

function monitorCard(page: Page, name: string) {
  return page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole('button', { name: new RegExp(`^${name}, `) }) });
}

test('heartbeat monitors render every phase on the public page', async ({ page }) => {
  const clientErrors = collectClientErrors(page);
  await page.goto('/');

  const upCard = monitorCard(page, 'Nightly Backup');
  await expect(
    page.getByRole('button', {
      name: new RegExp(
        `Nightly Backup, operational, last run ${UTC_STAMP}, next expected by ${UTC_STAMP}\\. Click to toggle details`,
      ),
    }),
  ).toBeVisible();
  await expect(upCard).toContainText(new RegExp(`last run ${UTC_STAMP}`));
  await expect(upCard.getByText('Last 2 runs')).toBeVisible();
  await expect(upCard.getByText('Every 24h, 30m grace', { exact: true })).toBeVisible();
  await expect(upCard.getByText('Next due', { exact: true })).toBeVisible();
  const strip = upCard.getByRole('group', {
    name: /\d+ runs, \d+ missed, \d+ failed, last run/,
  });
  await expect(strip).toBeVisible();
  await expect(upCard.locator('time').first()).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);

  const lateCard = monitorCard(page, 'Hourly Report');
  await expect(
    page.getByRole('button', { name: /Hourly Report, running late, last run/ }),
  ).toBeVisible();
  await expect(lateCard).toContainText(new RegExp(`Running late, expected by ${UTC_STAMP}`));

  const pendingCard = monitorCard(page, 'Weekly Prune');
  await expect(
    page.getByRole('button', { name: /Weekly Prune, waiting for first ping/ }),
  ).toBeVisible();
  await expect(pendingCard).toContainText('Waiting for first ping');
  await expect(
    pendingCard.getByText('No run recorded yet. The first ping starts the schedule.'),
  ).toBeVisible();
  await expect(pendingCard.locator('[data-slot="badge"]')).toHaveText('Pending');

  const runningCard = monitorCard(page, 'Index Rebuild');
  await expect(runningCard).toContainText(new RegExp(`Running since ${UTC_STAMP}`));

  const downCard = monitorCard(page, 'Log Shipper');
  await expect(page.getByRole('button', { name: /Log Shipper, overdue/ })).toBeVisible();
  await expect(downCard).toContainText(new RegExp(`Overdue, was expected by ${UTC_STAMP}`));
  await expect(downCard).not.toContainText(/No heartbeat since .+ \(expected by .+\)/);
  await expect(downCard.getByText('Overdue by', { exact: true })).toBeVisible();

  const failedCard = monitorCard(page, 'Nightly Compactor');
  await expect(
    page.getByRole('button', { name: /Nightly Compactor, overdue, last run/ }),
  ).toBeVisible();
  await expect(failedCard).toContainText('Job reported failure');
  await expect(failedCard.getByText('restic check failed')).toHaveCount(0);

  // The compactor fixture carries the full 90-run history with the miss
  // stored in state.misses, merged into the strip next to the ping runs.
  await expect(
    failedCard.getByRole('group', { name: /90 runs, 1 missed, 1 failed, last run/ }),
  ).toBeVisible();

  // The uptime badge samples cron minutes, so heartbeat cards explain it.
  const uptimeBadgeTooltip = upCard
    .locator('[data-slot="tooltip-trigger"]')
    .filter({ has: page.locator('[data-slot="badge"]') });
  await expect(async () => {
    await page.mouse.move(0, 0);
    await uptimeBadgeTooltip.hover();
    await expect(page.getByText(/Uptime samples this monitor once a minute/)).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 15_000 });

  expect(clientErrors).toEqual([]);
});

test('kind filter hides the other kind and lives in the URL', async ({ page }) => {
  const clientErrors = collectClientErrors(page);
  await page.goto('/');

  const filter = page.getByRole('group', { name: 'Filter monitors by kind' });
  await expect(filter).toBeVisible();

  // The click can land before hydration finishes so retry it with the URL check.
  await expect(async () => {
    await filter.getByRole('button', { name: 'Websites' }).click();
    await expect(page).toHaveURL(/kind=web/);
  }).toPass({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Nightly Backup, / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Toggle Scheduled jobs (6 jobs)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Example Domain, operational/ })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Some systems are down \(3 out of 12\)/i }),
  ).toBeVisible();

  await page.goto('/?kind=jobs');
  await expect(page.getByRole('button', { name: /Example Domain, operational/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Toggle Websites (2 monitors)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Toggle APIs (2 monitors)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Toggle Status Feeds (2 monitors)' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Toggle Scheduled jobs (6 jobs)' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Nightly Backup, / })).toBeVisible();
  expect(clientErrors).toEqual([]);
});

async function signInAsAdmin(page: Page): Promise<void> {
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
}

test('private monitor never appears on public surfaces but shows in admin with a badge', async ({
  page,
  request,
}) => {
  const { id: privateId, name: privateName } = privateMonitor;

  const homeHtml = await (await request.get('/')).text();
  expect(homeHtml).not.toContain(privateId);
  expect(homeHtml).not.toContain(privateName);
  expect(homeHtml).not.toContain(privateHeartbeat.id);
  expect(homeHtml).not.toContain(privateHeartbeat.name);
  expect(homeHtml).not.toContain(privateMonitor.maintenance);
  await page.goto('/');
  await expect(page.getByText('8 up / 1 late / 3 down')).toBeVisible();
  await expect(page.getByText('4 down')).toHaveCount(0);
  await expect(page.getByText(/out of 13/)).toHaveCount(0);
  await expect(page.getByText('Internal Billing')).toHaveCount(0);

  const eventsHtml = await (await request.get('/events')).text();
  expect(eventsHtml).not.toContain(privateId);
  expect(eventsHtml).not.toContain(privateName);
  expect(eventsHtml).not.toContain(privateMonitor.maintenance);

  const data = await readOkJson(await request.get('/api/data'), isPublicData);
  const dataBody = JSON.stringify(data);
  expect(dataBody).not.toContain(privateId);
  expect(dataBody).not.toContain(privateName);
  expect(dataBody).not.toContain(privateHeartbeat.id);
  expect(data).toMatchObject({ up: 9, down: 3 });
  expect(data.monitors[privateId]).toBeUndefined();

  const badgeResponse = await request.get(`/api/badge?id=${privateId}&label=badge-probe`);
  expect(badgeResponse.status()).toBe(404);
  const badgeBody = await badgeResponse.text();
  expect(badgeBody).not.toContain(privateId);
  expect(badgeBody).not.toContain(privateName);
  expect(JSON.parse(badgeBody)).toMatchObject({ isError: true, message: 'unknown' });

  const maintenancesBody = await (await request.get('/api/maintenances')).text();
  expect(maintenancesBody).not.toContain(privateId);
  expect(maintenancesBody).not.toContain(privateName);
  expect(maintenancesBody).not.toContain(privateMonitor.maintenance);

  const embedBody = await (await request.get(`/embed/${privateId}`)).text();
  expect(embedBody).not.toContain(privateName);
  expect(embedBody).toContain('not found');

  await page.goto('/admin');
  await signInAsAdmin(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: privateName })).toBeVisible();
  await expect(
    page.getByText(`${privateName} is private and never appears on the public page`),
  ).toBeAttached();
  await expect(page.getByText(privateMonitor.maintenance)).toBeVisible();

  // The admin list reads the authenticated, unfiltered state, so private cards
  // carry their real status instead of an empty one.
  await expect(page.getByText('Synthetic private outage')).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: new RegExp(`${privateHeartbeat.name}, operational, last run ${UTC_STAMP}`),
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Copy ping URL for ${privateHeartbeat.name}` }),
  ).toBeVisible();

  // The admin view is the only surface that carries the raw reported reason.
  await expect(
    page.getByText('restic check failed: pack 3f9a12 missing from repository'),
  ).toBeVisible();
  await expect(page.getByText('Reported', { exact: true })).toBeVisible();
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
    3,
  );
  await expect(page.locator('[data-slot="badge"]').filter({ hasText: /^Ongoing$/ })).toHaveCount(4);
  await expect(page.getByText(/No heartbeat since .+ \(expected by .+\)/)).toBeVisible();
  await expect(page.getByText('Synthetic E2E outage')).toBeVisible();
  expect(clientErrors).toEqual([]);
});

test('events route filters by type, monitor, and invalid month fallback', async ({ page }) => {
  const seeded = await readOkJson(
    await page.request.get('/api/maintenances'),
    isSeededMaintenanceList,
  );
  const upcoming = seeded.find((maintenance) => maintenance.title === 'E2E upcoming maintenance');
  if (!upcoming) throw new Error('seeded upcoming maintenance is missing');
  const upcomingMonth = upcoming.start.slice(0, 7);

  await page.goto('/events?type=incident');
  await expect(page).toHaveURL(/type=incident/);
  await expect(page.getByText('Synthetic E2E outage')).toBeVisible();
  await expect(page.getByText('E2E active maintenance')).not.toBeVisible();

  await page.goto('/events?type=maintenance');
  await expect(page).toHaveURL(/type=maintenance/);
  await expect(page.getByText('E2E active maintenance')).toBeVisible();
  await expect(page.getByText('Synthetic E2E outage')).not.toBeVisible();

  await page.goto(`/events?type=maintenance&month=${upcomingMonth}`);
  await expect(page.getByText('E2E upcoming maintenance')).toBeVisible();

  await page.goto(`/events?monitor=demo_example&month=${upcomingMonth}`);
  await expect(page).toHaveURL(/monitor=demo_example/);
  await expect(page.getByText('E2E upcoming maintenance')).toBeVisible();
  await expect(page.getByText('Synthetic E2E outage')).not.toBeVisible();

  await page.goto('/events?month=not-a-month');
  await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
  await expect(page.getByText('Incidents and scheduled maintenance')).toBeVisible();
  await expect(page).not.toHaveURL(/not-a-month/);
});

test('embed route renders seeded monitor status and variants', async ({ page, request }) => {
  const clientErrors = collectClientErrors(page);
  const embedHtml = await (await request.get('/embed/demo_example')).text();
  expectNoPrivateMonitorFields(embedHtml);
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

    await signInAsAdmin(page);

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
    const created: unknown = await createdResponse.json();
    if (!isValidMaintenance(created))
      throw new Error('created maintenance has an unexpected shape');

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
    const publicMaintenances = await readOkJson(publicMaintenancesResponse, isMaintenanceList);
    expect(
      publicMaintenances.some(
        (maintenance) =>
          maintenance.id === created.id &&
          maintenance.title === 'E2E lifecycle maintenance updated',
      ),
    ).toBe(true);

    await page.getByRole('button', { name: 'Delete E2E lifecycle maintenance updated' }).click();
    const deleteDialog = page.getByRole('dialog', { name: 'Delete maintenance window' });
    const deleted = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/admin/maintenances') &&
        response.request().method() === 'DELETE',
    );
    await deleteDialog.getByRole('button', { name: 'Delete' }).click();
    expect((await deleted).status()).toBe(204);

    await expect(page.getByText('E2E lifecycle maintenance updated')).not.toBeVisible();
  });
});

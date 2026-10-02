import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type APIResponse, type Page } from '@playwright/test';
import { isJsonObject } from '@flarewatch/shared';
import { workerConfig } from './config/worker';

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
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link')).toHaveText(['History']);
  await expect(nav.getByRole('link', { name: 'History' })).not.toHaveAttribute('aria-current');
  await expect(
    page.getByRole('contentinfo').getByRole('link', { name: 'GitHub', exact: true }),
  ).toHaveAttribute('href', 'https://github.com/saminnet/flarewatch');
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
      page.getByRole('link', { name: new RegExp(`^${monitor.name}, ${monitor.status}, `) }),
    ).toBeVisible();
    if (monitor.latency) {
      await expect(page.getByText(monitor.latency).filter({ visible: true }).first()).toBeVisible();
    }
    if (monitor.error) await expect(page.getByText(monitor.error)).toBeVisible();
  }

  // Rows stay one line: the history and the chart live on the monitor's page.
  await expect(page.getByTestId('latency-chart')).toHaveCount(0);

  await page.getByRole('button', { name: 'Toggle Websites (2 monitors)' }).click();
  await expect(page.getByRole('button', { name: 'Toggle Websites (2 monitors)' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByRole('link', { name: /Example Domain, operational/ })).not.toBeVisible();

  await page.getByRole('button', { name: 'Toggle Websites (2 monitors)' }).click();
  await expect(page.getByRole('link', { name: /Example Domain, operational/ })).toBeVisible();
  expect(clientErrors).toEqual([]);
});

test('a row opens the monitor page with its history and chart', async ({ page }) => {
  const clientErrors = collectClientErrors(page);
  await page.goto('/');
  await page.getByRole('link', { name: /^Cloudflare Docs, operational, / }).click();

  await expect(page).toHaveURL(/\/monitors\/demo_cloudflare_docs$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Cloudflare Docs' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Open site/ })).toHaveAttribute(
    'href',
    'https://developers.cloudflare.com/',
  );
  await expect(page.getByRole('heading', { name: 'Last 90 days' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Response times (ms)' })).toBeVisible();
  await expect(page.getByTestId('latency-chart')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check now' })).toHaveCount(0);

  await expect(page.getByText('No incidents or maintenance in the last 90 days.')).toBeVisible();
  await page.getByRole('link', { name: 'Full history' }).click();
  await expect(page).toHaveURL(/\/history\?.*monitor=demo_cloudflare_docs/);

  // Each page lists the monitor's own incidents and maintenance windows.
  await page.goto('/monitors/demo_cloudflare_status');
  const history = page.getByRole('region', { name: 'History' });
  await expect(history.getByText('Synthetic E2E outage')).toBeVisible();
  await expect(history.getByText('E2E active maintenance')).toHaveCount(0);
  await page.goto('/monitors/demo_cloudflare_trace');
  await expect(history.getByText('E2E active maintenance')).toBeVisible();
  expect(clientErrors).toEqual([]);
});

test('latency chart is server-rendered, labeled, and supports hover', async ({ page, request }) => {
  // SSR: the chart container and its SVG line/grid are in the raw server HTML, before any JS.
  const html = await (await request.get('/monitors/demo_example')).text();
  expectNoPrivateMonitorFields(html);
  expect(html).toContain('data-testid="latency-chart"');
  expect(html).toContain('vector-effect="non-scaling-stroke"');
  expect(html).toMatch(/fill="url\(#chart-fill-/);
  expect(html).toContain('stop-opacity="var(--chart-fill-top)"');

  await page.goto('/monitors/demo_example');
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

test('empty chart state renders on the trace page', async ({ page }) => {
  await page.goto('/monitors/demo_cloudflare_trace');
  await expect(page.getByText('No response data yet')).toBeVisible();
});

test.describe('latency chart touch', () => {
  test.use({ hasTouch: true });
  test('tooltip appears on touch press and clears on lift', async ({ page }) => {
    await page.goto('/monitors/demo_example');
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

  // The router matches paths in any letter case, so the admin gate must too.
  for (const path of [
    '/api/admin/maintenances',
    '/API/ADMIN/MAINTENANCES',
    '/api/Admin/maintenances',
  ]) {
    const unauthorizedAdminResponse = await request.get(path);
    expect(unauthorizedAdminResponse.status(), path).toBe(401);
  }
  const unauthorizedAdminWrite = await request.delete(
    '/API/admin/maintenances?id=e2e-active-maintenance',
  );
  expect(unauthorizedAdminWrite.status()).toBe(401);

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

test('rows show the last 90 days, or 30 on a phone, and still open the monitor page', async ({
  page,
}) => {
  const clientErrors = collectClientErrors(page);
  const docsRow = monitorRow(page, 'Cloudflare Docs');
  const cells = docsRow.locator('[data-slot="row-bars"] > span');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(cells.filter({ visible: true })).toHaveCount(30);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(cells.filter({ visible: true })).toHaveCount(90);
  await expect(
    page.getByRole('link', { name: /^Cloudflare Docs, .*, no downtime in the last 90 days$/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', {
      name: /^Cloudflare Status API, .*, downtime on [12] of the last 90 days$/,
    }),
  ).toBeVisible();
  await expect(
    monitorRow(page, 'Nightly Compactor').locator('[data-slot="row-bars"] > span'),
  ).toHaveCount(90);
  // A job that never ran has no history to show.
  await expect(monitorRow(page, 'Weekly Prune').locator('[data-slot="row-bars"]')).toHaveCount(0);

  // The strip is not a target of its own: a click on it lands on the row link.
  const strip = docsRow.locator('[data-slot="row-bars"]');
  await strip.scrollIntoViewIfNeeded();
  const box = await strip.boundingBox();
  if (!box) throw new Error('row strip has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/\/monitors\/demo_cloudflare_docs$/);
  expect(clientErrors).toEqual([]);
});

const UTC_STAMP = String.raw`\w{3} \d{1,2}, \d{2}:\d{2} UTC`;

function monitorRow(page: Page, name: string) {
  return page
    .locator('[data-slot="monitor-row"]')
    .filter({ has: page.getByRole('link', { name: new RegExp(`^${name}, `) }) });
}

test('heartbeat monitors render every phase on the public page', async ({ page }) => {
  const clientErrors = collectClientErrors(page);
  await page.goto('/');

  await expect(
    page.getByRole('link', {
      name: new RegExp(
        `^Nightly Backup, operational, last run ${UTC_STAMP}, next expected by ${UTC_STAMP}, last 2 runs: 0 missed, 0 failed, 0 late$`,
      ),
    }),
  ).toBeVisible();
  await expect(monitorRow(page, 'Nightly Backup')).toContainText(
    new RegExp(`last run ${UTC_STAMP}`),
  );
  await expect(
    page.getByRole('link', { name: /Hourly Report, running late, last run/ }),
  ).toBeVisible();
  await expect(monitorRow(page, 'Hourly Report')).toContainText(
    new RegExp(`Running late, expected by ${UTC_STAMP}`),
  );
  await expect(
    page.getByRole('link', { name: /Weekly Prune, waiting for first ping/ }),
  ).toBeVisible();
  await expect(monitorRow(page, 'Weekly Prune')).toContainText('Waiting for first ping');
  await expect(monitorRow(page, 'Weekly Prune').locator('[data-slot="badge"]')).toHaveText(
    'Pending',
  );
  await expect(monitorRow(page, 'Index Rebuild')).toContainText(
    new RegExp(`Running since ${UTC_STAMP}`),
  );
  await expect(page.getByRole('link', { name: /Log Shipper, overdue/ })).toBeVisible();
  await expect(monitorRow(page, 'Log Shipper')).toContainText(
    new RegExp(`Overdue, was expected by ${UTC_STAMP}`),
  );
  await expect(monitorRow(page, 'Log Shipper')).not.toContainText(
    /No heartbeat since .+ \(expected by .+\)/,
  );
  await expect(
    page.getByRole('link', { name: /Nightly Compactor, overdue, last run/ }),
  ).toBeVisible();
  await expect(monitorRow(page, 'Nightly Compactor')).toContainText('Job reported failure');

  // The uptime badge samples cron minutes, so heartbeat rows explain it.
  const uptimeBadgeTooltip = monitorRow(page, 'Nightly Backup')
    .locator('[data-slot="tooltip-trigger"]')
    .filter({ has: page.locator('[data-slot="badge"]') });
  await expect(async () => {
    await page.mouse.move(0, 0);
    await uptimeBadgeTooltip.hover();
    await expect(page.getByText(/Uptime samples this monitor once a minute/)).toBeVisible({
      timeout: 1000,
    });
  }).toPass({ timeout: 15_000 });

  await page.goto('/monitors/demo_nightly_backup');
  const upCard = page.locator('[data-slot="card"]');
  await expect(upCard.getByText('Last 2 runs')).toBeVisible();
  await expect(upCard.getByText('Every 24h, 30m grace', { exact: true })).toBeVisible();
  await expect(upCard.getByText('Next due', { exact: true })).toBeVisible();
  await expect(
    upCard.getByRole('group', { name: /\d+ runs, \d+ missed, \d+ failed, last run/ }),
  ).toBeVisible();
  await expect(upCard.locator('time').first()).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/);
  await expect(page.getByRole('button', { name: /Copy ping URL/ })).toHaveCount(0);

  await page.goto('/monitors/demo_weekly_prune');
  await expect(
    page.getByText('No run recorded yet. The first ping starts the schedule.'),
  ).toBeVisible();

  await page.goto('/monitors/demo_log_shipper');
  await expect(page.getByText('Overdue by', { exact: true })).toBeVisible();

  // The compactor fixture carries the full 90-run history with the miss
  // stored in state.misses, merged into the strip next to the ping runs.
  await page.goto('/monitors/demo_nightly_compactor');
  await expect(
    page.getByRole('group', { name: /90 runs, 1 missed, 1 failed, last run/ }),
  ).toBeVisible();
  await expect(page.getByText('restic check failed')).toHaveCount(0);

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
  await expect(page.getByRole('link', { name: /Nightly Backup, / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Toggle Scheduled jobs (6 jobs)' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Example Domain, operational/ })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Some systems are down \(3 out of 12\)/i }),
  ).toBeVisible();

  await page.goto('/?kind=jobs');
  await expect(page.getByRole('link', { name: /Example Domain, operational/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Toggle Websites (2 monitors)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Toggle APIs (2 monitors)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Toggle Status Feeds (2 monitors)' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Toggle Scheduled jobs (6 jobs)' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Nightly Backup, / })).toBeVisible();
  expect(clientErrors).toEqual([]);
});

async function signIn(page: Page): Promise<void> {
  await page.evaluate(async (credentials) => {
    const response = await fetch('/api/admin/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(credentials),
    });
    if (!response.ok) {
      throw new Error(`Sign-in failed with ${response.status}`);
    }
  }, adminCredentials);
}

test('the browser bundle carries no monitor or access config', () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), 'reads the local e2e build');
  const assets = path.join(process.cwd(), '.wrangler/e2e/public/build/client/assets');
  const scripts = readdirSync(assets).filter((file) => file.endsWith('.js'));
  expect(scripts.length).toBeGreaterThan(0);

  // Access rules and client ids stay on the server; provider names reach the sign-in page at run time.
  const markers = [
    ...workerConfig.monitors.flatMap((monitor) => [
      monitor.id,
      monitor.name,
      ...('target' in monitor ? [monitor.target] : []),
    ]),
    'operator@e2e.test',
    'partner@e2e.test',
    'flarewatch-e2e',
  ];
  for (const file of scripts) {
    const js = readFileSync(path.join(assets, file), 'utf8');
    expect(
      markers.filter((marker) => js.includes(marker)),
      file,
    ).toEqual([]);
  }
});

test('private monitor never appears to visitors but shows to the operator with a badge', async ({
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

  const historyHtml = await (await request.get('/history')).text();
  expect(historyHtml).not.toContain(privateId);
  expect(historyHtml).not.toContain(privateName);
  expect(historyHtml).not.toContain(privateMonitor.maintenance);

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

  const privatePage = await request.get(`/monitors/${privateId}`);
  expect(privatePage.status()).toBe(404);
  expect(await privatePage.text()).not.toContain(privateName);

  const embedBody = await (await request.get(`/embed/${privateId}`)).text();
  expect(embedBody).not.toContain(privateName);
  expect(embedBody).toContain('not found');

  await page.goto('/');
  await signIn(page);
  const signedInResponse = await page.request.get('/');
  expect(signedInResponse.headers()['cache-control']).toBe('private, no-store');
  expect(await signedInResponse.text()).toContain(privateName);

  const clientErrors = collectClientErrors(page);
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: /Account menu, signed in as e2e-admin/ }),
  ).toHaveText('EA');
  await expect(
    page.getByRole('heading', { name: /Some systems are down \(4 out of 14\)/i }),
  ).toBeVisible();
  await expect(page.getByText('9 up / 1 late / 4 down')).toBeVisible();
  await expect(page.getByRole('heading', { name: privateName })).toBeVisible();
  await expect(page.getByText(`${privateName} is private: visitors never see it`)).toBeAttached();
  await expect(page.getByText(privateMonitor.maintenance)).toBeVisible();

  // The operator reads the unfiltered state, so private cards carry their real
  // status instead of an empty one.
  await expect(page.getByText('Synthetic private outage')).toBeVisible();
  await page
    .getByRole('link', {
      name: new RegExp(`^${privateHeartbeat.name}, operational, last run ${UTC_STAMP}`),
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`/monitors/${privateHeartbeat.id}$`));
  await expect(
    page.getByRole('button', { name: `Copy ping URL for ${privateHeartbeat.name}` }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check now' })).toHaveCount(0);

  // Check now shows one check's result and saves nothing: the card keeps the stored outage.
  await page.goto(`/monitors/${privateId}`);
  const checkResult = page.getByRole('status', { name: 'Check now result' });
  // The button works only once the page has hydrated, so retry the click.
  await expect(async () => {
    await page.getByRole('button', { name: 'Check now' }).click();
    await expect(checkResult).toHaveText(/^(Up|Down)/, { timeout: 15_000 });
  }).toPass({ timeout: 45_000 });
  await page.reload();
  // The first match is the card's current error; History lists the incident below it.
  await expect(page.getByText('Synthetic private outage').first()).toHaveClass(/status-down/);
  await expect(checkResult).toBeEmpty();

  // Signed-in mode is the only surface that carries the raw reported reason.
  await page.goto('/monitors/demo_nightly_compactor');
  await expect(
    page.getByText('restic check failed: pack 3f9a12 missing from repository'),
  ).toBeVisible();
  await expect(page.getByText('Reported', { exact: true })).toBeVisible();

  await page.goto('/history');
  await expect(page.getByText(privateMonitor.maintenance)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add maintenance window' })).toBeVisible();
  expect(clientErrors).toEqual([]);
});

test('visitor view shows the operator the page as visitors see it', async ({ page }) => {
  const clientErrors = collectClientErrors(page);
  await page.goto('/');
  await signIn(page);
  await page.goto('/');

  // The menu opens only once the page has hydrated, so retry the click.
  const visitorView = page.getByRole('menuitemcheckbox', { name: 'Visitor view' });
  await expect(async () => {
    await page.getByRole('button', { name: /Account menu/ }).click();
    await expect(visitorView).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await visitorView.click();

  await expect(page).toHaveURL(/view=visitor/);
  await expect(page.getByText('Visitor view: this is the page as visitors see it.')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Some systems are down \(3 out of 12\)/i }),
  ).toBeVisible();
  await expect(page.getByText(privateMonitor.name)).toHaveCount(0);
  await expect(page.getByText(privateMonitor.maintenance)).toHaveCount(0);

  await page.getByRole('link', { name: /^Nightly Backup, / }).click();
  await expect(page).toHaveURL(/\/monitors\/demo_nightly_backup\?view=visitor/);
  await expect(page.getByRole('heading', { level: 1, name: 'Nightly Backup' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Copy ping URL/ })).toHaveCount(0);

  await page.getByRole('banner').getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(/\/history\?.*view=visitor/);
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add maintenance window' })).toHaveCount(0);
  await expect(page.getByText(privateMonitor.maintenance)).toHaveCount(0);

  await page.getByRole('link', { name: 'Exit visitor view' }).click();
  await expect(page).not.toHaveURL(/view=visitor/);
  await expect(page.getByRole('button', { name: 'Add maintenance window' })).toBeVisible();
  await expect(page.getByText(privateMonitor.maintenance)).toBeVisible();
  expect(clientErrors).toEqual([]);
});

test('history route renders seeded incidents and maintenance', async ({ page }) => {
  const clientErrors = collectClientErrors(page);
  await page.goto('/history');

  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'History' }),
  ).toHaveAttribute('aria-current', 'page');
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

test('history route filters by type, monitor, and invalid month fallback', async ({ page }) => {
  const seeded = await readOkJson(
    await page.request.get('/api/maintenances'),
    isSeededMaintenanceList,
  );
  const upcoming = seeded.find((maintenance) => maintenance.title === 'E2E upcoming maintenance');
  if (!upcoming) throw new Error('seeded upcoming maintenance is missing');
  const upcomingMonth = upcoming.start.slice(0, 7);

  await page.goto('/history?type=incident');
  await expect(page).toHaveURL(/type=incident/);
  await expect(page.getByText('Synthetic E2E outage')).toBeVisible();
  await expect(page.getByText('E2E active maintenance')).not.toBeVisible();

  await page.goto('/history?type=maintenance');
  await expect(page).toHaveURL(/type=maintenance/);
  await expect(page.getByText('E2E active maintenance')).toBeVisible();
  await expect(page.getByText('Synthetic E2E outage')).not.toBeVisible();

  await page.goto(`/history?type=maintenance&month=${upcomingMonth}`);
  await expect(page.getByText('E2E upcoming maintenance')).toBeVisible();

  await page.goto(`/history?monitor=demo_example&month=${upcomingMonth}`);
  await expect(page).toHaveURL(/monitor=demo_example/);
  await expect(page.getByText('E2E upcoming maintenance')).toBeVisible();
  await expect(page.getByText('Synthetic E2E outage')).not.toBeVisible();

  await page.goto('/history?month=not-a-month');
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
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
  await expect(page.getByRole('banner')).toHaveCount(0);
  await expect(page.getByRole('contentinfo')).toHaveCount(0);

  await page.goto('/embed/demo_cloudflare_status?theme=dark');
  await expect(page.getByText('Cloudflare Status API')).toBeVisible();
  await expect(page.getByText('Synthetic E2E outage')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/embed/demo_cloudflare_status?theme=light');
  await expect(page.getByText('Cloudflare Status API')).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  await page.goto('/embed/demo_cloudflare_status');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: 'light' });

  await page.goto('/embed/demo_cloudflare_status?minimal=true');
  await expect(page.getByText(/99\./)).toBeVisible();
  await expect(page.getByText('Cloudflare Status API')).not.toBeVisible();

  await page.goto('/embed/missing_monitor');
  await expect(page.getByText('Monitor with ID missing_monitor not found.')).toBeVisible();
  expect(clientErrors).toEqual([]);
});

test('another site can frame the embed but not the status page', async ({ page, baseURL }) => {
  await page.setContent(
    `<iframe id="embed" src="${baseURL}/embed/demo_example"></iframe>
     <iframe id="page" src="${baseURL}/"></iframe>`,
  );

  await expect(page.frameLocator('#embed').getByText('Example Domain')).toBeVisible();
  await expect(page.frameLocator('#page').getByRole('banner')).toHaveCount(0);
});

test('every script on a page carries the nonce from its Content-Security-Policy', async ({
  request,
}) => {
  for (const path of ['/', '/embed/demo_example']) {
    const response = await request.get(path);
    const policy = response.headers()['content-security-policy'] ?? '';
    const nonce = /script-src 'self' 'nonce-([^']+)';/.exec(policy)?.[1];
    expect(nonce, path).toBeTruthy();

    const scripts = [
      ...(await response.text()).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g),
    ].map(([, attrs = '', body = '']) => ({
      nonce: /\bnonce=["']([^"']*)["']/.exec(attrs)?.[1],
      body,
    }));
    expect(scripts.map((script) => script.nonce)).toEqual(scripts.map(() => nonce));
    const themeInit = scripts.filter(({ body }) => body.includes('__flarewatchSetThemePreference'));
    expect(themeInit, path).toHaveLength(1);
    expect(scripts.length, path).toBeGreaterThan(themeInit.length);
  }
});

test.describe.serial('operator maintenance lifecycle', () => {
  test.skip(
    Boolean(process.env.PLAYWRIGHT_BASE_URL),
    'mutating E2E tests require the local seeded Wrangler server',
  );

  test('signs in, manages maintenance on History, and signs out', async ({ page }) => {
    const clientErrors = collectClientErrors(page);
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

    // Form controls work only after hydration, so retry the first submit.
    await expect(async () => {
      await page.getByLabel('Username').fill(adminCredentials.username);
      await page.getByLabel('Password').fill('wrong-password');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('alert')).toHaveText('Invalid credentials', { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    // The browser logs the rejected sign-in request; nothing else may fail.
    expect(clientErrors.filter((error) => !error.includes('status of 401'))).toEqual([]);
    clientErrors.length = 0;

    await page.getByLabel('Password').fill(adminCredentials.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('button', { name: /Account menu/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);

    await page.getByRole('banner').getByRole('link', { name: 'History' }).click();
    await page.getByRole('button', { name: 'Add maintenance window' }).click();
    const addDialog = page.getByRole('dialog', { name: 'Add maintenance window' });
    await addDialog.getByLabel('Title').fill('E2E lifecycle maintenance');
    await addDialog.getByLabel('Description').fill('Created through the operator E2E flow.');
    await addDialog.getByRole('button', { name: 'Select start date' }).click();
    const month = new Date().toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    await page.getByRole('button', { name: new RegExp(`${month} 15th`) }).click();
    await addDialog.getByRole('button', { name: 'Example Domain' }).click();
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/admin/maintenances') &&
        response.request().method() === 'POST',
    );
    await addDialog.getByRole('button', { name: 'Save' }).click();
    expect((await created).status()).toBe(201);
    await expect(addDialog).not.toBeVisible();
    await expect(page.getByText('E2E lifecycle maintenance')).toBeVisible();

    await page.getByRole('button', { name: 'Edit E2E lifecycle maintenance' }).click();
    const editDialog = page.getByRole('dialog', { name: 'Edit maintenance window' });
    await expect(editDialog.getByLabel('Description')).toHaveValue(
      'Created through the operator E2E flow.',
    );
    await editDialog.getByLabel('Title').fill('E2E lifecycle maintenance updated');
    await editDialog.getByRole('button', { name: 'Save' }).click();
    await expect(editDialog).not.toBeVisible();
    await expect(page.getByText('E2E lifecycle maintenance updated')).toBeVisible();

    const publicMaintenances = await readOkJson(
      await page.request.get('/api/maintenances'),
      isMaintenanceList,
    );
    expect(publicMaintenances.map((maintenance) => maintenance.title)).toContain(
      'E2E lifecycle maintenance updated',
    );

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

    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page.getByRole('button', { name: /Account menu/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add maintenance window' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    expect((await page.request.get('/')).headers()['cache-control']).not.toBe('private, no-store');
    expect(clientErrors).toEqual([]);
  });

  test('repeats a maintenance window weekly from History', async ({ page }) => {
    const clientErrors = collectClientErrors(page);
    await page.goto('/login');
    await page.getByRole('link', { name: 'Continue with Test ID' }).click();
    await page.getByRole('link', { name: 'operator@e2e.test' }).click();
    await page.getByRole('link', { name: 'History' }).click();

    await page.getByRole('button', { name: 'Add maintenance window' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add maintenance window' });
    await dialog.getByLabel('Title').fill('E2E weekly maintenance');
    await dialog.getByLabel('Description').fill('Repeats on Mondays and Wednesdays.');
    const month = new Date().toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    await dialog.getByRole('button', { name: 'Select start date' }).click();
    await page.getByRole('button', { name: new RegExp(`${month} 15th`) }).click();
    await dialog.getByRole('combobox', { name: 'Repeat' }).click();
    await page.getByRole('option', { name: 'Every week' }).click();

    await expect(dialog.getByText('A repeating window needs an end')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();

    await dialog.getByRole('button', { name: 'Select end date' }).click();
    await page.getByRole('button', { name: new RegExp(`${month} 16th`) }).click();
    await dialog.getByRole('button', { name: 'Monday' }).click();
    await dialog.getByRole('button', { name: 'Wednesday' }).click();
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/admin/maintenances') &&
        response.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: 'Save' }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    expect(await response.json()).toMatchObject({ repeat: { every: 'week', weekdays: [1, 3] } });
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText('Every week on Mon, Wed').first()).toBeVisible();

    await page.getByRole('button', { name: 'Delete E2E weekly maintenance' }).first().click();
    const deleted = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/admin/maintenances') &&
        response.request().method() === 'DELETE',
    );
    await page
      .getByRole('dialog', { name: 'Delete maintenance window' })
      .getByRole('button', { name: 'Delete' })
      .click();
    expect((await deleted).status()).toBe(204);
    await expect(page.getByText('E2E weekly maintenance')).toHaveCount(0);
    expect(clientErrors).toEqual([]);
  });
});

test.describe('provider sign-in', () => {
  test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), 'needs the local fake provider');

  async function signInAs(page: Page, email: string): Promise<void> {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Continue with Test ID' }).click();
    await page.getByRole('link', { name: email }).click();
  }

  test('a member sees every monitor, private ones too, and edits nothing', async ({ page }) => {
    await signInAs(page, 'member@e2e.test');

    await expect(
      page.getByRole('button', { name: /Account menu, signed in as member/ }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Internal Billing API' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Internal Vault Backup' })).toBeVisible();
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add maintenance window' })).toHaveCount(0);
    await page.goto('/monitors/demo_private_internal');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Internal Billing API' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check now' })).toHaveCount(0);
  });

  test('an audience member sees their page group and no other private monitor', async ({
    page,
  }) => {
    await signInAs(page, 'partner@e2e.test');

    await expect(page.getByRole('heading', { name: 'Internal Billing API' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Internal Vault Backup' })).toHaveCount(0);
  });

  test('the operator signs in with the provider and can edit maintenance', async ({ page }) => {
    await signInAs(page, 'operator@e2e.test');

    await expect(page.getByRole('heading', { name: 'Internal Vault Backup' })).toBeVisible();
    await page.getByRole('link', { name: 'History' }).click();
    await expect(page.getByRole('button', { name: 'Add maintenance window' })).toBeVisible();
  });

  test('someone no rule lets in is sent back to sign-in with a reason', async ({ page }) => {
    await signInAs(page, 'stranger@e2e.test');

    await expect(page).toHaveURL(/\/login\?error=denied$/);
    await expect(page.getByRole('alert')).toHaveText(
      'This account is not allowed to sign in here.',
    );
    await expect(page.getByRole('heading', { name: 'Internal Billing API' })).toHaveCount(0);
  });
});

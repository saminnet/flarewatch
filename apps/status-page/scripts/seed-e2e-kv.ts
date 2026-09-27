import { execFileSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HeartbeatRun, HeartbeatState, Maintenance, MonitorState } from '@flarewatch/shared';
import { formatUtcShort, isJsonObject } from '@flarewatch/shared/utils';
import { privateMonitor } from '../tests/e2e/config/worker.ts';

// Copies the FLAREWATCH_E2E build out of dist, so the public and private instances each keep theirs.
const variant = process.env.FLAREWATCH_E2E === 'private' ? 'private' : 'public';
const appDir = process.cwd();
const variantDir = path.join(appDir, '.wrangler/e2e', variant);
const buildDir = path.join(variantDir, 'build');
const persistDir = path.join(variantDir, 'state');
const fixtureDir = path.join(variantDir, 'fixtures');
const envFilePath = path.join(appDir, '.wrangler/e2e.dev.vars');
const configPath = path.join(buildDir, 'server/wrangler.json');
const e2eConfigPath = path.join(buildDir, 'server/e2e-wrangler.json');

// Public deterministic credentials for the local Playwright instance only; never a production secret.
const E2E_ADMIN_AUTH_SECRET = JSON.stringify({
  username: 'e2e-admin',
  salt: 'ZmxhcmV3YXRjaC1lMmUtc2FsdA',
  hash: '8drBsSZBJKVwUgda2cPGEVYigJjx6mu1-J_iUCB1rrs',
});

const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * MINUTE_SECONDS;
const DAY_SECONDS = 24 * HOUR_SECONDS;

function writeFixture(name: string, value: unknown): string {
  const filePath = path.join(fixtureDir, name);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return filePath;
}

function wranglerKvPut(key: string, fixturePath: string): void {
  execFileSync(
    'vp',
    [
      'exec',
      'wrangler',
      'kv',
      'key',
      'put',
      key,
      '--path',
      fixturePath,
      '--binding',
      'FLAREWATCH_STATE',
      '--local',
      '--persist-to',
      persistDir,
      '--config',
      e2eConfigPath,
    ],
    { cwd: appDir, stdio: 'inherit' },
  );
}

rmSync(variantDir, { recursive: true, force: true });
cpSync(path.join(appDir, 'dist'), buildDir, { recursive: true });
mkdirSync(fixtureDir, { recursive: true });

const parsedWranglerConfig: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
if (!isJsonObject(parsedWranglerConfig)) {
  throw new Error(`Expected an object in ${configPath}`);
}
const existingVars = isJsonObject(parsedWranglerConfig.vars) ? parsedWranglerConfig.vars : {};
const wranglerConfig = {
  ...parsedWranglerConfig,
  vars: { ...existingVars, FLAREWATCH_ADMIN_BASIC_AUTH: E2E_ADMIN_AUTH_SECRET },
};

writeFileSync(e2eConfigPath, `${JSON.stringify(wranglerConfig, null, 2)}\n`);
writeFileSync(envFilePath, `FLAREWATCH_ADMIN_BASIC_AUTH='${E2E_ADMIN_AUTH_SECRET}'\n`);

const nowSec = Math.floor(Date.now() / 1000);
const startedAt = nowSec - 90 * DAY_SECONDS;
const incidentStart = nowSec - 90 * MINUTE_SECONDS;

const backupSuccess = nowSec - 3 * HOUR_SECONDS;
const reportSuccess = nowSec - HOUR_SECONDS - 2 * MINUTE_SECONDS;
const rebuildSuccess = nowSec - 50 * MINUTE_SECONDS;
const shipperSuccess = nowSec - 2 * HOUR_SECONDS;
const shipperDeadline = shipperSuccess + HOUR_SECONDS + 5 * MINUTE_SECONDS;
const vaultSuccess = nowSec - 2 * HOUR_SECONDS;
const compactorFail = nowSec - 3 * HOUR_SECONDS;
const compactorSuccess = compactorFail - DAY_SECONDS;
const compactorDeadline = compactorSuccess + DAY_SECONDS + 30 * MINUTE_SECONDS;

// Full 90-run shape for screenshots and e2e: ok x80, miss, ok x5, late,
// ok x2, fail, one run per day ending at the fail. The miss is stored in
// state.misses (cron-detected) and merges with the ping runs in the view.
const compactorOutcomes: HeartbeatRun['outcome'][] = [
  ...Array<HeartbeatRun['outcome']>(80).fill('ok'),
  'miss',
  ...Array<HeartbeatRun['outcome']>(5).fill('ok'),
  'late',
  ...Array<HeartbeatRun['outcome']>(2).fill('ok'),
  'fail',
];
const compactorMiss = compactorFail - 9 * DAY_SECONDS;
const compactorRuns: HeartbeatRun[] = compactorOutcomes
  .map((outcome, index) => {
    const at = compactorFail - (89 - index) * DAY_SECONDS;
    return outcome === 'ok' || outcome === 'miss'
      ? { at, outcome }
      : { at, outcome, startedAt: at - 12 * MINUTE_SECONDS };
  })
  .filter((run) => run.outcome !== 'miss');

const okRun = (at: number, runMinutes = 12) => ({
  at,
  outcome: 'ok' as const,
  startedAt: at - runMinutes * MINUTE_SECONDS,
});

const heartbeatState = {
  demo_nightly_backup: {
    status: 'up',
    lastSuccess: backupSuccess,
    deadline: backupSuccess + DAY_SECONDS + 30 * MINUTE_SECONDS,
    runs: [okRun(backupSuccess - DAY_SECONDS), okRun(backupSuccess)],
  },
  demo_hourly_report: {
    status: 'late',
    lastSuccess: reportSuccess,
    deadline: reportSuccess + HOUR_SECONDS + 5 * MINUTE_SECONDS,
    runs: [
      okRun(reportSuccess - 2 * HOUR_SECONDS),
      okRun(reportSuccess - HOUR_SECONDS),
      { at: reportSuccess, outcome: 'late' as const, startedAt: reportSuccess - 190 },
    ],
  },
  demo_weekly_prune: { status: 'pending' },
  demo_index_rebuild: {
    status: 'running',
    lastSuccess: rebuildSuccess,
    lastStart: nowSec - 4 * MINUTE_SECONDS,
    deadline: rebuildSuccess + HOUR_SECONDS + 10 * MINUTE_SECONDS,
    runs: [okRun(rebuildSuccess - HOUR_SECONDS), okRun(rebuildSuccess)],
  },
  demo_log_shipper: {
    status: 'down',
    lastSuccess: shipperSuccess,
    deadline: shipperDeadline,
    runs: [
      okRun(shipperSuccess - HOUR_SECONDS),
      { at: shipperSuccess, outcome: 'ok' as const, startedAt: shipperSuccess - 182 },
      {
        at: shipperDeadline,
        outcome: 'miss' as const,
      },
    ],
  },
  demo_nightly_compactor: {
    status: 'down',
    lastSuccess: compactorSuccess,
    lastFail: compactorFail,
    message: 'restic check failed: pack 3f9a12 missing from repository',
    deadline: compactorDeadline,
    misses: [compactorMiss],
    runs: compactorRuns,
  },
  demo_private_backup: {
    status: 'up',
    lastSuccess: vaultSuccess,
    deadline: vaultSuccess + DAY_SECONDS + 30 * MINUTE_SECONDS,
    runs: [okRun(vaultSuccess)],
  },
} satisfies Record<string, HeartbeatState>;

const shipperError = `No heartbeat since ${formatUtcShort(shipperSuccess)} (expected by ${formatUtcShort(shipperDeadline)})`;
const compactorError = 'Job reported failure';

const latency = (base: number, loc: string) => ({
  recent: Array.from({ length: 12 }, (_, index) => ({
    loc,
    ping: base + ((index * 13) % 37),
    time: nowSec - (11 - index) * 10 * MINUTE_SECONDS,
  })),
});

const state: MonitorState = {
  lastUpdate: nowSec,
  // What runChecks computes for the fixture's public monitors: late jobs count
  // in overallUp as well as overallLate, and pending or running jobs count as up.
  overallUp: 9,
  overallDown: 3,
  overallLate: 1,
  startedAt: {
    demo_example: startedAt,
    demo_cloudflare_trace: startedAt,
    demo_cloudflare_status: startedAt,
    demo_cloudflare_docs: startedAt,
    demo_one_dns_trace: startedAt,
    demo_github_status: startedAt,
    [privateMonitor.id]: startedAt,
    demo_nightly_backup: startedAt,
    demo_hourly_report: startedAt,
    demo_index_rebuild: startedAt,
    demo_log_shipper: startedAt,
    demo_nightly_compactor: startedAt,
    demo_private_backup: startedAt,
  },
  incident: {
    demo_example: [],
    demo_cloudflare_trace: [],
    demo_cloudflare_status: [
      {
        start: [incidentStart],
        end: undefined,
        error: ['Synthetic E2E outage'],
      },
    ],
    demo_cloudflare_docs: [],
    demo_one_dns_trace: [],
    demo_github_status: [],
    [privateMonitor.id]: [
      {
        start: [incidentStart],
        end: undefined,
        error: ['Synthetic private outage'],
      },
    ],
    demo_nightly_backup: [],
    demo_hourly_report: [],
    demo_weekly_prune: [],
    demo_index_rebuild: [],
    demo_log_shipper: [
      {
        start: [shipperDeadline],
        end: undefined,
        error: [shipperError],
      },
    ],
    demo_nightly_compactor: [
      {
        start: [compactorFail],
        end: undefined,
        error: [compactorError],
      },
    ],
    demo_private_backup: [],
  },
  latency: {
    demo_example: latency(42, 'HEL'),
    demo_cloudflare_trace: { recent: [] },
    demo_cloudflare_status: latency(210, 'SFO'),
    demo_cloudflare_docs: latency(28, 'AMS'),
    demo_one_dns_trace: latency(12, 'ZRH'),
    demo_github_status: latency(95, 'IAD'),
    [privateMonitor.id]: latency(88, 'FRA'),
  },
  heartbeat: heartbeatState,
};

const maintenances: Maintenance[] = [
  {
    id: 'e2e-active-maintenance',
    title: 'E2E active maintenance',
    body: 'Synthetic active maintenance window for browser tests.',
    monitors: ['demo_cloudflare_trace'],
    start: new Date((nowSec - 30 * MINUTE_SECONDS) * 1000).toISOString(),
    end: new Date((nowSec + 30 * MINUTE_SECONDS) * 1000).toISOString(),
    color: 'blue',
    createdAt: nowSec * 1000,
    updatedAt: nowSec * 1000,
  },
  {
    id: 'e2e-upcoming-maintenance',
    title: 'E2E upcoming maintenance',
    body: 'Synthetic upcoming maintenance window for browser tests.',
    monitors: ['demo_example'],
    start: new Date((nowSec + DAY_SECONDS) * 1000).toISOString(),
    end: new Date((nowSec + DAY_SECONDS + HOUR_SECONDS) * 1000).toISOString(),
    color: 'amber',
    createdAt: nowSec * 1000,
    updatedAt: nowSec * 1000,
  },
  {
    id: 'e2e-private-maintenance',
    title: 'E2E private maintenance',
    body: 'Synthetic maintenance window scoped to a private monitor only.',
    monitors: [privateMonitor.id],
    start: new Date((nowSec - 30 * MINUTE_SECONDS) * 1000).toISOString(),
    end: new Date((nowSec + 30 * MINUTE_SECONDS) * 1000).toISOString(),
    color: 'blue',
    createdAt: nowSec * 1000,
    updatedAt: nowSec * 1000,
  },
];

wranglerKvPut('state', writeFixture('state.json', state));
wranglerKvPut('maintenances', writeFixture('maintenances.json', maintenances));

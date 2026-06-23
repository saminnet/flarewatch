import { execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Maintenance, MonitorState } from '@flarewatch/shared';

const appDir = process.cwd();
const persistDir = path.join(appDir, '.wrangler/e2e-state');
const fixtureDir = path.join(appDir, '.wrangler/e2e-fixtures');
const envFilePath = path.join(appDir, '.wrangler/e2e.dev.vars');
const configPath = path.join(appDir, 'dist/server/wrangler.json');
const e2eConfigPath = path.join(appDir, 'dist/server/e2e-wrangler.json');

// Public, deterministic credentials for the local Playwright Wrangler instance only.
// This is not a production secret and should never be used outside seeded E2E state.
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

rmSync(persistDir, { recursive: true, force: true });
rmSync(fixtureDir, { recursive: true, force: true });
mkdirSync(fixtureDir, { recursive: true });
mkdirSync(path.dirname(e2eConfigPath), { recursive: true });

const wranglerConfig = JSON.parse(readFileSync(configPath, 'utf8')) as {
  vars?: Record<string, unknown>;
};
wranglerConfig.vars = {
  ...wranglerConfig.vars,
  FLAREWATCH_ADMIN_BASIC_AUTH: E2E_ADMIN_AUTH_SECRET,
};
writeFileSync(e2eConfigPath, `${JSON.stringify(wranglerConfig, null, 2)}\n`);
writeFileSync(envFilePath, `FLAREWATCH_ADMIN_BASIC_AUTH='${E2E_ADMIN_AUTH_SECRET}'\n`);

const nowSec = Math.floor(Date.now() / 1000);
const startedAt = nowSec - 90 * DAY_SECONDS;
const incidentStart = nowSec - 90 * MINUTE_SECONDS;

const latency = (base: number, loc: string) => ({
  recent: Array.from({ length: 12 }, (_, index) => ({
    loc,
    ping: base + ((index * 13) % 37),
    time: nowSec - (11 - index) * 10 * MINUTE_SECONDS,
  })),
});

const state: MonitorState = {
  lastUpdate: nowSec,
  overallUp: 2,
  overallDown: 1,
  startedAt: {
    demo_example: startedAt,
    demo_cloudflare_trace: startedAt,
    demo_cloudflare_status: startedAt,
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
  },
  latency: {
    demo_example: latency(42, 'HEL'),
    demo_cloudflare_trace: { recent: [] },
    demo_cloudflare_status: latency(210, 'SFO'),
  },
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
];

wranglerKvPut('state', writeFixture('state.json', state));
wranglerKvPut('maintenances', writeFixture('maintenances.json', maintenances));

import { vi } from 'vite-plus/test';
import type { CheckResult, PullMonitor } from '@flarewatch/shared';
import type { Alert, AlertPolicy } from '../../src/hub/alerts';
import { createHub } from './hub';

export const scenarios: readonly (readonly [
  string,
  string,
  { grace?: number; error?: string; threshold?: number; reminder?: number }?,
])[] = [
  ['first incident and close', 'D U'],
  ['reopen boundary', 'D U D@1960'],
  ['new incident beyond boundary', 'D U D@1961'],
  ['reopen resets acknowledgement', 'D ack U D'],
  ['relapse keeps acknowledgement', 'D U D ack U D'],
  ['hold boundary', 'D U D U@1200 U@2099 U@2100'],
  [
    'relapse restarts grace',
    'D U D U D D@1700',
    {
      grace: 300,
    },
  ],
  [
    'legacy Certificate recovery',
    'D U D U',
    {
      error: 'Certificate expires in 14 days (threshold: 30)',
    },
  ],
  [
    'legacy SSL certificate recovery',
    'D U D U',
    {
      error: 'SSL certificate expires in 14 days (threshold: 30)',
    },
  ],
  [
    'missing check and threshold',
    'D N D U D D D',
    {
      threshold: 3,
    },
  ],
  [
    'threshold and reopen',
    'D D U D D',
    {
      threshold: 2,
    },
  ],
  [
    'open incident bypasses streak',
    'D D U D D U D',
    {
      threshold: 2,
    },
  ],
  ['live down lease and lost owner', 'D D@2199 D@2200 refuse:0 D@2260'],
  [
    'recorded refusal limit',
    'D refuse D refuse D refuse D refuse D refuse D refuse D refuse D refuse D refuse D refuse D refuse',
  ],
  ['abandoned down claims', 'D D@2200 D@3400 D@4600'],
  ['deferred down', 'D defer D'],
  ['reopen during down send', 'D U D deliver:0 D'],
  ['late down success after close', 'D U deliver:0 U'],
  ['error cap', 'D deliver E E E E E E'],
  ['deferred error', 'D deliver E defer D'],
  ['refused error', 'D deliver E refuse D'],
  ['error generation fence', 'D deliver E U D refuse:1 E'],
  ['error relapse continuity', 'D deliver U D deliver E U D defer:3 D'],
  ['error outcome ordering', 'D deliver E E defer:1 D'],
  [
    'reminder cadence',
    'D deliver D D refuse D D',
    {
      reminder: 2,
    },
  ],
  [
    'acknowledgement suppresses reminders',
    'D deliver ack D U D deliver D',
    {
      reminder: 1,
    },
  ],
  [
    'reminder generation fence',
    'D deliver D U D deliver:1 D',
    {
      reminder: 1,
    },
  ],
  ['recovery ownership', 'D deliver U U@2259 U@2260 deliver:1 U'],
  ['recovery accepted', 'D deliver U deliver U'],
  ['recovery refused', 'D deliver U refuse U'],
  ['recovery deferred', 'D deliver U defer U'],
  ['recovery cancelled by reopen', 'D deliver U defer D'],
  ['recovery cancelled by removal', 'D deliver U defer remove U'],
  ['recovery cancelled by skip', 'D deliver U defer skip U'],
  ['recovery cancelled by policy removal', 'D deliver U defer noPolicy U'],
  ['expiry acceptance', 'W deliver W V W'],
  ['expiry deferral and stored warning', 'W defer N N'],
  ['eviction reconstruction', 'D evict refuse D'],
  ['duplicate error outcomes', 'D deliver E E refuse:1 refuse:1 E'],
  [
    'duplicate reminder outcomes',
    'D deliver D deliver:1 deliver:1 D',
    {
      reminder: 1,
    },
  ],
] as const;

export function replay(
  sequence: string,
  options: { grace?: number; error?: string; threshold?: number; reminder?: number } = {},
) {
  const initial = createHub();
  let hub = initial.hub;
  const monitor: PullMonitor = {
    id: 'api',
    name: 'API',
    method: 'GET',
    target: 'https://example.com',
    sslCheckEnabled: true,
    ...(options.threshold !== undefined && { downAfterChecks: options.threshold }),
    ...(options.reminder !== undefined && { reminderEveryChecks: options.reminder }),
  };
  let policy: AlertPolicy | undefined = {
    gracePeriodSeconds: options.grace ?? 0,
    skipIds: [],
    skipErrorChanges: false,
  };
  const claims: Alert[][] = [];
  const log: unknown[] = [];
  let now = 940;
  let error = options.error ?? 'A';
  for (const token of sequence.split(' ')) {
    if (token === 'evict') {
      hub = createHub(initial.db).hub;
      continue;
    }
    if (token === 'noPolicy') {
      policy = undefined;
      continue;
    }
    if (token === 'skip') {
      if (policy) policy.skipIds = ['api'];
      continue;
    }
    if (token === 'ack') {
      vi.spyOn(Date, 'now').mockReturnValue((now + 1) * 1000);
      log.push({
        token,
        accepted: hub.ackIncident('api', 'Pat'),
        history: hub.view().monitors.api?.incidents,
      });
      continue;
    }
    if (/^(deliver|refuse|defer)/.test(token)) {
      const [kind, index] = token.split(':');
      const alerts = claims[index === undefined ? claims.length - 1 : Number(index)] ?? [];
      const outcomes = alerts.map((alert) => ({
        ...alert,
        delivered: kind === 'deliver',
        ...(kind === 'defer' && { deferred: true }),
      }));
      hub.confirmAlerts(outcomes);
      log.push({ token, outcomes });
      continue;
    }
    const [kind, at] = token.split('@');
    now = at === undefined ? now + 60 : Number(at);
    if (kind === 'E') error += '!';
    const result: CheckResult =
      kind === 'U' || kind === 'W' || kind === 'V'
        ? {
            ok: true,
            latency: 1,
            ...((kind === 'W' || kind === 'V') && {
              warning: { text: 'Expires soon', expiryDate: kind === 'W' ? 2000000 : 3000000 },
            }),
          }
        : { ok: false, error };
    const records =
      kind === 'remove'
        ? []
        : [{ monitor, ...(kind !== 'N' && { check: { location: 'HEL', result } }) }];
    const output = hub.record(now, records, policy);
    claims.push(output.alerts);
    log.push({
      token,
      now,
      records,
      policy: policy ? { ...policy, skipIds: [...policy.skipIds] } : null,
      ...output,
      history: hub.view().monitors.api?.incidents ?? [],
    });
  }
  return log;
}

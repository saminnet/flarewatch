// Pins the accepted and rejected shapes inherited from the pre-Zod guards; webhook payload and
// monitor method validation are intentionally stricter.
import { describe, expect, it } from 'vite-plus/test';
import { configIssues, isValidMaintenance, parseMaintenances } from '../src/config';

const monitor = { id: 'm1', name: 'M1', method: 'GET', target: 'https://example.com' };

const runtimeConfigCases: Array<[string, unknown, boolean]> = [
  ['minimal valid', { monitors: [] }, true],
  ['not an object', 'nope', false],
  ['null', null, false],
  ['array', [], false],
  ['monitors missing', {}, false],
  ['monitors not an array', { monitors: {} }, false],
  [
    'tcp_ping rejects port 0',
    { monitors: [{ ...monitor, method: 'TCP_PING', target: 'example.com:0' }] },
    false,
  ],
  ['ftp url rejected for GET', { monitors: [{ ...monitor, target: 'ftp://example.com' }] }, false],
  [
    'unknown monitor fields ignored',
    { monitors: [{ ...monitor, tooltip: 5, expectedCodes: 'nope' }] },
    true,
  ],
  ['monitor timeout of a minute', { monitors: [{ ...monitor, timeout: 60_000 }] }, true],
  ['monitor timeout over a minute', { monitors: [{ ...monitor, timeout: 60_001 }] }, false],
  ['monitor timeout of zero', { monitors: [{ ...monitor, timeout: 0 }] }, false],
  ['monitor timeout as a string', { monitors: [{ ...monitor, timeout: '5000' }] }, false],
  ['monitor link to a URL', { monitors: [{ ...monitor, link: 'https://a.com/x' }] }, true],
  ['monitor link turned off', { monitors: [{ ...monitor, link: false }] }, true],
  [
    'javascript: monitor link rejected',
    { monitors: [{ ...monitor, link: 'javascript:alert(1)' }] },
    false,
  ],
  [
    'heartbeat javascript: link rejected',
    {
      monitors: [
        {
          id: 'job',
          name: 'Job',
          method: 'HEARTBEAT',
          periodSeconds: 60,
          graceSeconds: 0,
          link: ' javascript:alert(1)',
        },
      ],
    },
    false,
  ],
  [
    'page links to URLs and paths',
    {
      monitors: [],
      statusPage: {
        links: [
          { label: 'Home', link: 'https://example.com' },
          { label: 'About', link: '/about', highlight: true },
        ],
      },
    },
    true,
  ],
  [
    'javascript: page link rejected',
    { monitors: [], statusPage: { links: [{ label: 'x', link: 'java\tscript:alert(1)' }] } },
    false,
  ],
  [
    'javascript: poweredByUrl rejected',
    { monitors: [], statusPage: { poweredByUrl: 'javascript:alert(1)' } },
    false,
  ],
  [
    'data: image favicon and logo accepted',
    {
      monitors: [],
      statusPage: { favicon: 'data:image/png;base64,AAAA', logo: '/logo.svg' },
    },
    true,
  ],
  [
    'data: html logo rejected',
    { monitors: [], statusPage: { logo: 'data:text/html,<script>alert(1)</script>' } },
    false,
  ],
  [
    'webhook timeout over a minute',
    { monitors: [], notification: { webhook: { url: 'https://a.com', timeout: 60_001 } } },
    false,
  ],
  [
    'webhook timeout of zero',
    { monitors: [], notification: { webhook: { url: 'https://a.com', timeout: 0 } } },
    false,
  ],
  [
    'webhook timeout of a minute',
    { monitors: [], notification: { webhook: { url: 'https://a.com', timeout: 60_000 } } },
    true,
  ],
  ['extra top-level keys ignored', { monitors: [], somethingElse: 42 }, true],
  ['statusPage title must be a string', { monitors: [], statusPage: { title: 5 } }, false],
  ['statusPage other fields ignored', { monitors: [], statusPage: { theme: 42 } }, true],
  ['statusPage private visibility', { monitors: [], statusPage: { visibility: 'private' } }, true],
  // A typo must not silently leave a private page public.
  ['statusPage unknown visibility', { monitors: [], statusPage: { visibility: 'Private' } }, false],
  [
    'notification timeZone must be a string',
    { monitors: [], notification: { timeZone: 5 } },
    false,
  ],
  [
    'notification gracePeriod must be a number',
    { monitors: [], notification: { gracePeriod: 'x' } },
    false,
  ],
  [
    'infinite gracePeriod rejected',
    { monitors: [], notification: { gracePeriod: Infinity } },
    false,
  ],
  ['NaN gracePeriod rejected', { monitors: [], notification: { gracePeriod: NaN } }, false],
  [
    'skipNotificationIds must be strings',
    { monitors: [], notification: { skipNotificationIds: [1] } },
    false,
  ],
  ['webhook needs a url', { monitors: [], notification: { webhook: {} } }, false],
  [
    'webhook url must be http',
    { monitors: [], notification: { webhook: { url: 'ftp://x.com' } } },
    false,
  ],
  [
    'webhook array accepted',
    { monitors: [], notification: { webhook: [{ url: 'https://a.com' }] } },
    true,
  ],
  [
    'unknown template rejected',
    { monitors: [], notification: { webhook: { url: 'https://a.com', template: 'nope' } } },
    false,
  ],
  [
    'lowercase method accepted',
    { monitors: [], notification: { webhook: { url: 'https://a.com', method: 'post' } } },
    true,
  ],
  [
    'unknown webhook method rejected',
    { monitors: [], notification: { webhook: { url: 'https://a.com', method: 'TRACE' } } },
    false,
  ],
  [
    'numeric header value accepted',
    { monitors: [], notification: { webhook: { url: 'https://a.com', headers: { a: 1 } } } },
    true,
  ],
  [
    'boolean header value rejected',
    { monitors: [], notification: { webhook: { url: 'https://a.com', headers: { a: true } } } },
    false,
  ],
  [
    'param payload null accepted',
    {
      monitors: [],
      notification: { webhook: { url: 'https://a.com', payloadType: 'param', payload: null } },
    },
    true,
  ],
  [
    'unknown payloadType rejected',
    { monitors: [], notification: { webhook: { url: 'https://a.com', payloadType: 'xml' } } },
    false,
  ],
  [
    'webhook timeout must be a number',
    { monitors: [], notification: { webhook: { url: 'https://a.com', timeout: '5' } } },
    false,
  ],
  [
    'infinite webhook timeout rejected',
    { monitors: [], notification: { webhook: { url: 'https://a.com', timeout: Infinity } } },
    false,
  ],
  [
    'NaN webhook timeout rejected',
    { monitors: [], notification: { webhook: { url: 'https://a.com', timeout: NaN } } },
    false,
  ],
];

const maintenanceBase = { id: 'x', body: 'b', createdAt: 1, updatedAt: 2, start: 3 };

const maintenanceCases: Array<[string, unknown, boolean]> = [
  ['minimal valid', maintenanceBase, true],
  ['string start accepted', { ...maintenanceBase, start: '2026-01-01' }, true],
  ['empty id rejected', { ...maintenanceBase, id: '' }, false],
  ['empty body rejected', { ...maintenanceBase, body: '' }, false],
  ['missing start rejected', { id: 'x', body: 'b', createdAt: 1, updatedAt: 2 }, false],
  ['infinite createdAt rejected', { ...maintenanceBase, createdAt: Infinity }, false],
  ['NaN updatedAt rejected', { ...maintenanceBase, updatedAt: NaN }, false],
  ['infinite start rejected', { ...maintenanceBase, start: Infinity }, false],
  ['NaN start rejected', { ...maintenanceBase, start: NaN }, false],
  ['infinite end rejected', { ...maintenanceBase, end: Infinity }, false],
  ['NaN end rejected', { ...maintenanceBase, end: NaN }, false],
  ['boolean end rejected', { ...maintenanceBase, end: true }, false],
  ['numeric end accepted', { ...maintenanceBase, end: 9 }, true],
  ['unparseable start rejected', { ...maintenanceBase, start: 'soon' }, false],
  ['unparseable end rejected', { ...maintenanceBase, end: '2026-13-45' }, false],
  ['end before start rejected', { ...maintenanceBase, start: 10, end: 5 }, false],
  [
    'string end after string start accepted',
    { ...maintenanceBase, start: '2026-01-01T10:00:00Z', end: '2026-01-01T12:00:00Z' },
    true,
  ],
  ['monitors must be strings', { ...maintenanceBase, monitors: [1] }, false],
  ['colour must be a string', { ...maintenanceBase, color: 1 }, false],
  ['extra keys ignored', { ...maintenanceBase, whatever: {} }, true],
  ['not an object', 7, false],
];

describe('config guard parity', () => {
  it.each(runtimeConfigCases)('runtime config: %s', (_name, value, expected) => {
    expect(configIssues(value).length === 0).toBe(expected);
  });

  it.each(maintenanceCases)('maintenance: %s', (_name, value, expected) => {
    expect(isValidMaintenance(value)).toBe(expected);
  });

  it('parseMaintenances keeps the valid entries and drops the rest', () => {
    expect(parseMaintenances([maintenanceBase, { id: '' }, 5])).toEqual([maintenanceBase]);
    expect(parseMaintenances('nope')).toEqual([]);
  });
});

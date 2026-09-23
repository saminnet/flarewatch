// Pins the accepted and rejected shapes inherited from the pre-Zod guards; webhook payload
// validation is intentionally stricter.
import { describe, expect, it } from 'vite-plus/test';
import {
  isStoredConfigEnvelope,
  isValidMaintenance,
  isValidRuntimeConfig,
  parseMaintenances,
  parseRuntimeConfig,
} from '../src/config';

const monitor = { id: 'm1', name: 'M1', method: 'GET', target: 'https://example.com' };

const runtimeConfigCases: Array<[string, unknown, boolean]> = [
  ['minimal valid', { monitors: [] }, true],
  ['one http monitor', { monitors: [monitor] }, true],
  ['not an object', 'nope', false],
  ['null', null, false],
  ['array', [], false],
  ['monitors missing', {}, false],
  ['monitors not an array', { monitors: {} }, false],
  ['empty id', { monitors: [{ ...monitor, id: '' }] }, false],
  ['empty name', { monitors: [{ ...monitor, name: '' }] }, false],
  ['non-string method', { monitors: [{ ...monitor, method: 1 }] }, false],
  [
    'unknown method keeps any target',
    { monitors: [{ ...monitor, method: 'WEIRD', target: 'x' }] },
    true,
  ],
  [
    'http method needs a url',
    { monitors: [{ ...monitor, method: 'POST', target: 'notaurl' }] },
    false,
  ],
  [
    'tcp_ping needs host:port',
    { monitors: [{ ...monitor, method: 'TCP_PING', target: 'example.com:443' }] },
    true,
  ],
  [
    'tcp_ping rejects bare host',
    { monitors: [{ ...monitor, method: 'TCP_PING', target: 'example.com' }] },
    false,
  ],
  [
    'tcp_ping rejects port 0',
    { monitors: [{ ...monitor, method: 'TCP_PING', target: 'example.com:0' }] },
    false,
  ],
  ['ftp url rejected for GET', { monitors: [{ ...monitor, target: 'ftp://example.com' }] }, false],
  [
    'unknown monitor fields ignored',
    { monitors: [{ ...monitor, timeout: 'not-a-number', expectedCodes: 'nope' }] },
    true,
  ],
  ['extra top-level keys ignored', { monitors: [], somethingElse: 42 }, true],
  ['statusPage title must be a string', { monitors: [], statusPage: { title: 5 } }, false],
  ['statusPage other fields ignored', { monitors: [], statusPage: { links: 'nope' } }, true],
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
    'param payload must be an object',
    {
      monitors: [],
      notification: { webhook: { url: 'https://a.com', payloadType: 'param', payload: 'x' } },
    },
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
    'json payload may be a string',
    {
      monitors: [],
      notification: { webhook: { url: 'https://a.com', payloadType: 'json', payload: 'x' } },
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
  ['monitors must be strings', { ...maintenanceBase, monitors: [1] }, false],
  ['colour must be a string', { ...maintenanceBase, color: 1 }, false],
  ['extra keys ignored', { ...maintenanceBase, whatever: {} }, true],
  ['not an object', 7, false],
];

describe('config guard parity', () => {
  it.each(runtimeConfigCases)('runtime config: %s', (_name, value, expected) => {
    expect(isValidRuntimeConfig(value)).toBe(expected);
  });

  it.each(maintenanceCases)('maintenance: %s', (_name, value, expected) => {
    expect(isValidMaintenance(value)).toBe(expected);
  });

  it('envelope unwraps a nested config and parseRuntimeConfig accepts both shapes', () => {
    const config = { monitors: [monitor] };
    expect(isStoredConfigEnvelope({ config })).toBe(true);
    expect(isStoredConfigEnvelope({ config: { monitors: 'no' } })).toBe(false);
    expect(parseRuntimeConfig({ config })).toEqual(config);
    expect(parseRuntimeConfig(config)).toEqual(config);
    expect(parseRuntimeConfig({ nope: 1 })).toBeNull();
  });

  it('parseMaintenances keeps the valid entries and drops the rest', () => {
    expect(parseMaintenances([maintenanceBase, { id: '' }, 5])).toEqual([maintenanceBase]);
    expect(parseMaintenances('nope')).toEqual([]);
  });

  it('parseRuntimeConfig returns the original object, extra keys intact', () => {
    const config = { monitors: [], extra: 'kept' };
    expect(parseRuntimeConfig(config)).toBe(config);
  });
});

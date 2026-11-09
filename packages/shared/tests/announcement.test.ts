import { describe, expect, it } from 'vite-plus/test';
import { normalizeAnnouncement } from '../src/announcement';

const notice = { title: 'API delays', body: 'Requests take longer than usual.' };
const update = {
  at: '2026-10-20T12:00:00Z',
  status: 'identified',
  body: 'We found the cause.',
  by: 'Pat',
};

describe('manual incident normalization', () => {
  it('normalizes incident fields and keeps updates oldest first', () => {
    expect(
      normalizeAnnouncement({
        ...notice,
        kind: 'incident',
        monitors: ['api', 'api'],
        status: 'investigating',
        updates: [update],
      }),
    ).toEqual({
      value: {
        ...notice,
        kind: 'incident',
        monitors: ['api'],
        status: 'identified',
        updates: [{ ...update, at: '2026-10-20T12:00:00.000Z' }],
      },
    });
  });
  it('treats a legacy row as a notice', () => {
    expect(normalizeAnnouncement(notice)).toEqual({ value: { ...notice, kind: 'notice' } });
  });
  it.each([
    ['bad status', { status: 'broken' }],
    ['oversized update', { updates: [{ ...update, body: 'x'.repeat(2001) }] }],
    ['too many updates', { updates: Array.from({ length: 21 }, () => update) }],
    ['bad update status', { updates: [{ ...update, status: 'broken' }] }],
    ['bad date', { updates: [{ ...update, at: 'tomorrow' }] }],
    ['reverse order', { updates: [update, { ...update, at: '2026-10-19T00:00:00Z' }] }],
    ['empty update', { updates: [{ ...update, body: ' ' }] }],
    ['invalid monitor ids', { monitors: [1] }],
    ['bad kind', { kind: 'outage' }],
    ['null kind', { kind: null }],
    ['null status', { status: null }],
    ['empty responder', { updates: [{ ...update, by: ' ' }] }],
    ['numeric update date', { updates: [{ ...update, at: 123 }] }],
  ])('rejects %s', (_name, fields) => {
    expect(normalizeAnnouncement({ ...notice, kind: 'incident', ...fields })).toHaveProperty(
      'error',
    );
  });
  it('allows the update limits and rejects incident fields on notices', () => {
    expect(
      normalizeAnnouncement({
        ...notice,
        kind: 'incident',
        updates: Array.from({ length: 20 }, () => ({ ...update, body: 'x'.repeat(2000) })),
      }),
    ).toHaveProperty('value');
    expect(normalizeAnnouncement({ ...notice, status: 'resolved' })).toHaveProperty('error');
  });
});

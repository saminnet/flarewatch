import { describe, expect, it } from 'vite-plus/test';
import type { Maintenance } from '@flarewatch/shared';
import { normalizeMaintenanceUpdates } from '@/routes/api/admin/maintenances';

const current: Maintenance = {
  id: 'maint_1',
  title: 'Upgrade',
  body: 'Database upgrade',
  start: '2026-01-01T00:00:00.000Z',
  end: '2026-01-01T02:00:00.000Z',
  monitors: ['api'],
  color: 'amber',
  createdAt: 0,
  updatedAt: 0,
};

describe('normalizeMaintenanceUpdates', () => {
  it('clears nullable fields sent as null', () => {
    expect(
      normalizeMaintenanceUpdates({ title: null, color: null, monitors: null, end: null }, current),
    ).toStrictEqual({ title: undefined, color: undefined, monitors: undefined, end: undefined });
  });

  it('leaves fields that are absent from the update untouched', () => {
    expect(normalizeMaintenanceUpdates({}, current)).toStrictEqual({});
  });

  it('rejects an empty body', () => {
    expect(normalizeMaintenanceUpdates({ body: '' }, current)).toBeNull();
  });

  it('rejects an end before the start', () => {
    expect(normalizeMaintenanceUpdates({ end: '2025-12-31T00:00:00.000Z' }, current)).toBeNull();
  });

  it('checks ordering against the epoch as an end', () => {
    expect(normalizeMaintenanceUpdates({ end: 0 }, current)).toBeNull();
  });
});

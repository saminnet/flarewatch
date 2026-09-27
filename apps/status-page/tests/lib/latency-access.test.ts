import { describe, expect, it } from 'vite-plus/test';
import type { RuntimeConfig } from '@flarewatch/shared';
import { latencyAccess } from '@/lib/public-view';

const config: RuntimeConfig = {
  monitors: [
    { id: 'api', name: 'API', method: 'GET', target: 'https://api.example.com' },
    { id: 'db', name: 'DB', method: 'TCP_PING', target: 'db.internal:5432', private: true },
    { id: 'backup', name: 'Backup', method: 'HEARTBEAT', periodSeconds: 60, graceSeconds: 10 },
  ],
};

describe('latencyAccess', () => {
  it('lets anyone read a published monitor on a public page', () => {
    expect(latencyAccess(config, 'api', false)).toBe('anyone');
  });

  it('keeps a private monitor to the operator', () => {
    expect(latencyAccess(config, 'db', false)).toBe('operator');
  });

  it('keeps every monitor to the operator on a private-only page', () => {
    expect(latencyAccess(config, 'api', true)).toBe('operator');
  });

  it('serves nothing for jobs and unknown ids', () => {
    expect(latencyAccess(config, 'backup', false)).toBe('none');
    expect(latencyAccess(config, 'ghost', false)).toBe('none');
  });
});

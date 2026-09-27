import type { AccessConfig } from '@flarewatch/shared';

export const accessConfig: AccessConfig = {
  providers: [
    { id: 'test-id', name: 'Test ID', issuer: 'http://127.0.0.1:3102', clientId: 'flarewatch-e2e' },
  ],
  operators: ['operator@e2e.test'],
  members: ['member@e2e.test'],
  audiences: { partner: { members: ['partner@e2e.test'], groups: ['Partner'] } },
};

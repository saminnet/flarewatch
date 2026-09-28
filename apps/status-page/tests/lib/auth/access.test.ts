import { describe, expect, it } from 'vite-plus/test';
import type { AccessConfig } from '@flarewatch/shared';
import { principalFor, type Identity } from '@/lib/auth/access';

const access: AccessConfig = {
  providers: [{ id: 'oidc', name: 'ID', issuer: 'https://id.example', clientId: 'flarewatch' }],
  operators: ['Owner@Example.com', 'group:admins'],
  members: ['*@team.example', 'github:Octocat'],
  audiences: {
    acme: { members: ['*@acme.example'], groups: ['Acme'] },
    beta: { members: ['pat@acme.example'], groups: ['Beta', 'Acme'] },
  },
};

function person(overrides: Partial<Extract<Identity, { kind: 'provider' }>> = {}): Identity {
  return {
    kind: 'provider',
    provider: 'oidc',
    name: 'x',
    emailVerified: true,
    groups: [],
    ...overrides,
  };
}

describe('principalFor', () => {
  it('makes the password sign-in the operator', () => {
    expect(principalFor({}, { kind: 'password', secret: 'fingerprint' })).toEqual({
      role: 'operator',
    });
  });

  it('matches emails without regard to case, and groups exactly', () => {
    expect(principalFor(access, person({ email: 'owner@example.COM' }))).toEqual({
      role: 'operator',
    });
    expect(principalFor(access, person({ groups: ['admins'] }))).toEqual({ role: 'operator' });
    expect(principalFor(access, person({ groups: ['Admins'] }))).toBeNull();
  });

  it('matches a domain rule on that exact domain only', () => {
    expect(principalFor(access, person({ email: 'kim@team.example' }))).toEqual({
      role: 'member',
      groups: 'all',
    });
    expect(principalFor(access, person({ email: 'kim@evil.team.example' }))).toBeNull();
    expect(principalFor(access, person({ email: 'kim@team.example.org' }))).toBeNull();
  });

  it('ignores an email the provider has not verified', () => {
    expect(
      principalFor(access, person({ email: 'owner@example.com', emailVerified: false })),
    ).toBeNull();
  });

  it('matches GitHub logins without regard to case', () => {
    expect(principalFor(access, person({ githubLogin: 'octocat' }))).toEqual({
      role: 'member',
      groups: 'all',
    });
  });

  it('gives the highest role, then the union of audience groups', () => {
    expect(principalFor(access, person({ email: 'kim@team.example', groups: ['admins'] }))).toEqual(
      {
        role: 'operator',
      },
    );
    expect(principalFor(access, person({ email: 'pat@acme.example' }))).toEqual({
      role: 'member',
      groups: ['Acme', 'Beta'],
    });
  });

  it('lets nobody in from a provider that is no longer configured', () => {
    expect(
      principalFor(access, person({ provider: 'removed', email: 'owner@example.com' })),
    ).toBeNull();
  });

  it('lets nobody in who matches no rule', () => {
    expect(principalFor(access, person({ email: 'stranger@example.net' }))).toBeNull();
    expect(principalFor({}, person({ email: 'owner@example.com' }))).toBeNull();
  });
});

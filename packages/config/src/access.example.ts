/**
 * Example sign-in configuration. Copy what you need into access.ts.
 * Client secrets never go here: they live in the FLAREWATCH_OIDC_SECRETS
 * secret, as JSON keyed by provider id. The password sign-in
 * (FLAREWATCH_ADMIN_BASIC_AUTH) keeps working next to these.
 */

import type { AccessConfig } from '@flarewatch/shared';

export const accessConfig: AccessConfig = {
  providers: [
    // Any OpenID Connect provider: Pocket ID, Google, Authentik, Keycloak.
    // Callback URL to register: https://<your status page>/auth/callback
    { id: 'pocket-id', name: 'Pocket ID', issuer: 'https://id.example.com', clientId: '...' },
    { id: 'google', name: 'Google', issuer: 'https://accounts.google.com', clientId: '...' },
    // GitHub OAuth app. Its secret goes under "github" in FLAREWATCH_OIDC_SECRETS.
    { id: 'github', name: 'GitHub', type: 'github', clientId: '...' },
  ],

  // Everything: all monitors, maintenance editing, ping URLs.
  operators: ['you@example.com', 'group:flarewatch-admins'],

  // Every monitor, private ones included, read only.
  members: ['*@example.com', 'github:teammate'],

  // Published monitors plus the monitors in these page groups.
  audiences: {
    acme: { members: ['*@acme.example'], groups: ['Acme'] },
  },
};

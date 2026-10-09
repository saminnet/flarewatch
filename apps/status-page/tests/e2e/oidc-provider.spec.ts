import { createHash } from 'node:crypto';
import { expect } from '@playwright/test';
import { test } from './fixtures';

for (const [name, exchanged, method, status] of [
  ['matching verifier', 'test-verifier', 'S256', 200],
  ['different verifier', 'wrong-verifier', 'S256', 400],
  ['empty verifier', '', 'S256', 400],
  ['plain challenge method', 'test-verifier', 'plain', 400],
] as const) {
  test(`fake OIDC provider checks PKCE: ${name}`, async ({ request }) => {
    const issuer = 'http://127.0.0.1:3102';
    const challenge = createHash('sha256').update('test-verifier').digest('base64url');
    const authorize = await request.get(`${issuer}/authorize`, {
      params: {
        redirect_uri: 'http://127.0.0.1:3100/auth/callback',
        state: 'test-state',
        nonce: 'test-nonce',
        code_challenge: challenge,
        code_challenge_method: method,
      },
    });
    const link = /href="([^"]+)"/.exec(await authorize.text())?.[1];
    expect(link).toBeTruthy();
    const code = new URL(link!).searchParams.get('code');
    expect(code).toBeTruthy();
    const token = await request.post(`${issuer}/token`, {
      form: { code: code!, code_verifier: exchanged },
    });
    expect(token.status()).toBe(status);
    if (status === 200) expect(await token.json()).toHaveProperty('id_token');
    else expect(await token.json()).toEqual({ error: 'invalid_grant' });
  });
}

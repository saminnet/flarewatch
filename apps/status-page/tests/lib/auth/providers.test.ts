import { describe, expect, it, vi } from 'vite-plus/test';
import type { AuthProvider, JsonObject } from '@flarewatch/shared';
import { authorizationUrl, identify, SignInError, type Fetch } from '@/lib/auth/providers';

const NOW = 1_800_000_000;
let issuerCount = 0;

/** A fresh issuer per test, so the per-isolate discovery cache never carries over. */
function oidcProvider(): Extract<AuthProvider, { issuer: string }> {
  issuerCount++;
  return {
    id: 'pocket-id',
    name: 'Pocket ID',
    issuer: `https://id${issuerCount}.example`,
    clientId: 'fw',
  };
}

function idToken(claims: JsonObject): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll('=', '');
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`;
}

function fakeOidc(provider: { issuer: string }, claims: JsonObject, scopes = ['openid']) {
  const tokenBodies: string[] = [];
  const fetchFn = vi.fn<Fetch>(async (url, init) => {
    if (url === `${provider.issuer}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: provider.issuer,
        authorization_endpoint: `${provider.issuer}/authorize`,
        token_endpoint: `${provider.issuer}/token`,
        scopes_supported: scopes,
      });
    }
    if (url === `${provider.issuer}/token`) {
      tokenBodies.push(typeof init?.body === 'string' ? init.body : '');
      return Response.json({ id_token: idToken(claims) });
    }
    return new Response('not found', { status: 404 });
  });
  return { fetchFn, tokenBodies };
}

const input = {
  code: 'code-1',
  redirectUri: 'https://status.example/auth/callback',
  verifier: 'verifier-1',
  nonce: 'nonce-1',
  clientSecret: undefined,
  nowSeconds: NOW,
};

describe('OpenID Connect sign-in', () => {
  const good = (issuer: string) => ({
    iss: issuer,
    aud: 'fw',
    exp: NOW + 60,
    nonce: 'nonce-1',
    sub: 'u1',
    email: 'Kim@Example.com',
    email_verified: 'true',
    name: 'Kim',
    groups: ['admins', 7],
  });

  it('sends the browser to the discovered endpoint with PKCE and nonce, asking for groups only when offered', async () => {
    const provider = oidcProvider();
    const { fetchFn } = fakeOidc(provider, {}, ['openid', 'groups']);
    const url = new URL(
      await authorizationUrl(
        provider,
        { redirectUri: input.redirectUri, state: 's', nonce: 'n', challenge: 'c' },
        fetchFn,
      ),
    );

    expect(url.origin + url.pathname).toBe(`${provider.issuer}/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'fw',
      redirect_uri: input.redirectUri,
      scope: 'openid email profile groups',
      state: 's',
      nonce: 'n',
      code_challenge: 'c',
      code_challenge_method: 'S256',
    });

    const plain = oidcProvider();
    const other = new URL(
      await authorizationUrl(
        plain,
        { redirectUri: 'r', state: 's', nonce: 'n', challenge: 'c' },
        fakeOidc(plain, {}).fetchFn,
      ),
    );
    expect(other.searchParams.get('scope')).toBe('openid email profile');
  });

  it('trades the code with the verifier and returns who signed in', async () => {
    const provider = oidcProvider();
    const { fetchFn, tokenBodies } = fakeOidc(provider, good(provider.issuer));

    await expect(identify(provider, { ...input, clientSecret: 'shh' }, fetchFn)).resolves.toEqual({
      kind: 'provider',
      provider: 'pocket-id',
      name: 'Kim',
      email: 'Kim@Example.com',
      emailVerified: true,
      groups: ['admins'],
    });
    const body = new URLSearchParams(tokenBodies[0]);
    expect(body.get('code_verifier')).toBe('verifier-1');
    expect(body.get('client_secret')).toBe('shh');
  });

  it('sends no client secret for a public client', async () => {
    const provider = oidcProvider();
    const { fetchFn, tokenBodies } = fakeOidc(provider, good(provider.issuer));
    await identify(provider, input, fetchFn);
    expect(new URLSearchParams(tokenBodies[0]).has('client_secret')).toBe(false);
  });

  it.each([
    ['another issuer', { iss: 'https://evil.example' }],
    ['another audience', { aud: 'someone-else' }],
    ['several audiences without azp', { aud: ['fw', 'other'] }],
    ['an expired token', { exp: NOW }],
    ['another nonce', { nonce: 'replayed' }],
  ])('refuses an ID token with %s', async (_label, override) => {
    const provider = oidcProvider();
    const { fetchFn } = fakeOidc(provider, { ...good(provider.issuer), ...override });
    await expect(identify(provider, input, fetchFn)).rejects.toBeInstanceOf(SignInError);
  });

  it('refuses a token endpoint without TLS, which the unsigned ID token relies on', async () => {
    const provider = oidcProvider();
    const plain = `http://${new URL(provider.issuer).host}/token`;
    const fetchFn = vi.fn<Fetch>(async (url) =>
      url === plain
        ? Response.json({ id_token: idToken(good(provider.issuer)) })
        : Response.json({
            issuer: provider.issuer,
            authorization_endpoint: `${provider.issuer}/authorize`,
            token_endpoint: plain,
          }),
    );
    await expect(identify(provider, input, fetchFn)).rejects.toBeInstanceOf(SignInError);
  });

  it('refuses an authorization endpoint without TLS', async () => {
    const provider = oidcProvider();
    const fetchFn = vi.fn<Fetch>(async () =>
      Response.json({
        issuer: provider.issuer,
        authorization_endpoint: `http://${new URL(provider.issuer).host}/authorize`,
        token_endpoint: `${provider.issuer}/token`,
      }),
    );
    await expect(
      authorizationUrl(
        provider,
        { redirectUri: 'https://s/cb', state: 's', nonce: 'n', challenge: 'c' },
        fetchFn,
      ),
    ).rejects.toBeInstanceOf(SignInError);
  });

  it('refuses a discovery document for another issuer', async () => {
    const provider = oidcProvider();
    // Everything else about this sign-in is valid for the other issuer.
    const fetchFn = vi.fn<Fetch>(async (url) =>
      url === 'https://evil.example/t'
        ? Response.json({
            id_token: idToken({
              iss: 'https://evil.example',
              aud: 'fw',
              exp: NOW + 60,
              nonce: 'nonce-1',
            }),
          })
        : Response.json({
            issuer: 'https://evil.example',
            authorization_endpoint: 'https://evil.example/a',
            token_endpoint: 'https://evil.example/t',
          }),
    );
    await expect(identify(provider, input, fetchFn)).rejects.toBeInstanceOf(SignInError);
  });
});

describe('GitHub sign-in', () => {
  const github: AuthProvider = { id: 'github', name: 'GitHub', type: 'github', clientId: 'gh' };

  function fakeGithub(emails: unknown) {
    return vi.fn<Fetch>(async (url) => {
      if (url === 'https://github.com/login/oauth/access_token')
        return Response.json({ access_token: 't' });
      if (url === 'https://api.github.com/user')
        return Response.json({ login: 'Octocat', name: null });
      if (url === 'https://api.github.com/user/emails') return Response.json(emails);
      return new Response('not found', { status: 404 });
    });
  }

  it('uses the login and only a primary, verified email', async () => {
    const identity = await identify(
      github,
      input,
      fakeGithub([
        { email: 'old@example.com', primary: false, verified: true },
        { email: 'octo@example.com', primary: true, verified: true },
      ]),
    );
    expect(identity).toEqual({
      kind: 'provider',
      provider: 'github',
      name: 'Octocat',
      email: 'octo@example.com',
      emailVerified: true,
      groups: [],
      githubLogin: 'Octocat',
    });
  });

  it('leaves the email out when the primary one is not verified', async () => {
    const identity = await identify(
      github,
      input,
      fakeGithub([{ email: 'octo@example.com', primary: true, verified: false }]),
    );
    expect(identity).toMatchObject({ emailVerified: false, githubLogin: 'Octocat' });
    expect(identity).not.toHaveProperty('email');
  });
});

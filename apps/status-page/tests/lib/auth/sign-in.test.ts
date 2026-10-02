import { describe, expect, it, vi } from 'vite-plus/test';
import type { AccessConfig, JsonObject } from '@flarewatch/shared';
import { finishSignIn, startSignIn } from '@/lib/auth/sign-in.server';
import type { Fetch } from '@/lib/auth/providers';
import { memoryKv } from '../../helpers/kv';

const ISSUER = 'https://id.sign-in.test';
const access: AccessConfig = {
  providers: [{ id: 'pocket-id', name: 'Pocket ID', issuer: ISSUER, clientId: 'fw' }],
  operators: ['owner@example.com'],
};

function idToken(claims: JsonObject): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll('=', '');
  return `${encode({ alg: 'none' })}.${encode(claims)}.x`;
}

/** A provider that signs in `email` and echoes the nonce it was given at authorize time. */
function fakeProvider(email: string) {
  let nonce = '';
  const fetchFn = vi.fn<Fetch>(async (url) => {
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
      });
    }
    if (url === `${ISSUER}/token`) {
      return Response.json({
        id_token: idToken({
          iss: ISSUER,
          aud: 'fw',
          exp: Math.floor(Date.now() / 1000) + 60,
          nonce,
          email,
          email_verified: true,
        }),
      });
    }
    return new Response('not found', { status: 404 });
  });
  return {
    fetchFn,
    remember: (location: string) => (nonce = new URL(location).searchParams.get('nonce') ?? ''),
  };
}

async function signIn(email: string, next = '/history', allowed = true) {
  const kv = memoryKv();
  const limiter = { limit: async () => ({ success: allowed }) };
  const env: Cloudflare.Env = {
    FLAREWATCH_AUTH_SECRET: 'test-secret',
    FLAREWATCH_STATE: kv,
    LOGIN_RATE_LIMIT: limiter as typeof limiter & RateLimit,
  };
  const provider = fakeProvider(email);
  const start = await startSignIn(
    new Request(`https://status.test/auth/pocket-id?next=${encodeURIComponent(next)}`),
    'pocket-id',
    { env, access, fetch: provider.fetchFn },
  );
  const location = start.headers.get('Location') ?? '';
  provider.remember(location);
  const flowCookie = (start.headers.get('Set-Cookie') ?? '').split(';')[0] ?? '';
  const state = new URL(location).searchParams.get('state');
  const callback = (query: string, cookie = flowCookie) =>
    finishSignIn(
      new Request(`https://status.test/auth/callback?${query}`, { headers: { Cookie: cookie } }),
      { env, access, fetch: provider.fetchFn },
    );
  return { kv, start, location, flowCookie, state, callback };
}

describe('provider sign-in', () => {
  it('starts with a short-lived, HttpOnly, Lax cookie scoped to /auth', async () => {
    const { start, location } = await signIn('owner@example.com');

    expect(start.status).toBe(302);
    expect(location.startsWith(`${ISSUER}/authorize?`)).toBe(true);
    expect(start.headers.get('Set-Cookie')).toMatch(
      /^flarewatch_sign_in=[^;]+; Path=\/auth; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/,
    );
  });

  it('signs an allowed person in and returns them to where they started', async () => {
    const { kv, state, callback } = await signIn('owner@example.com', '/monitors/api');

    const response = await callback(`code=c1&state=${state}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.text()).resolves.toContain('url=/monitors/api');
    const cookies = response.headers.getSetCookie();
    expect(cookies[0]).toMatch(
      /^flarewatch_admin_session=[^;]+; Path=\/; HttpOnly; SameSite=Strict/,
    );
    expect(cookies[1]).toMatch(/^flarewatch_sign_in=; .*Max-Age=0/);
    const [, session] = kv.put.mock.calls[0] ?? [];
    expect(JSON.parse(session ?? '{}')).toMatchObject({
      identity: { kind: 'provider', provider: 'pocket-id', email: 'owner@example.com' },
    });
  });

  it('turns away someone no rule lets in, without writing a session', async () => {
    const { kv, state, callback } = await signIn('stranger@example.com');

    const response = await callback(`code=c1&state=${state}`);

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://status.test/login?error=denied');
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('writes no session once the IP is over the sign-in limit', async () => {
    const { kv, state, callback } = await signIn('owner@example.com', '/history', false);

    const response = await callback(`code=c1&state=${state}`);

    expect(response.headers.get('Location')).toBe('https://status.test/login?error=limited');
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('refuses an answer for a sign-in this browser did not start', async () => {
    const { state, flowCookie, callback } = await signIn('owner@example.com');
    const [name = '', value = ''] = flowCookie.split('=');
    const forged = `${name}=${value.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))}`;

    for (const response of [
      await callback(`code=c1&state=${state}`, ''),
      await callback('code=c1&state=guessed'),
      await callback(`code=c1&state=${state}`, forged),
    ]) {
      expect(response.headers.get('Location')).toBe('https://status.test/login?error=expired');
    }
  });

  it('never returns someone to another site', async () => {
    const { state, callback } = await signIn('owner@example.com', '//evil.example/"><script>');

    const body = await (await callback(`code=c1&state=${state}`)).text();

    expect(body).toContain('url=/"');
    expect(body).not.toContain('evil');
  });

  it('answers 404 for a provider that is not configured', async () => {
    const response = await startSignIn(new Request('https://status.test/auth/github'), 'github', {
      env: { FLAREWATCH_AUTH_SECRET: 's' },
      access,
    });
    expect(response.status).toBe(404);
  });
});

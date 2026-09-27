import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { AccessConfig } from '@flarewatch/shared';
import type { Identity } from '@/lib/auth/access';
import {
  endSession,
  passwordIdentity,
  resolvePrincipal,
  resolveViewer,
  sessionName,
  startSession,
} from '@/lib/operator.server';
import { isSessionExpiredError, SessionExpiredError } from '@/lib/query/auth.mutations';
import { memoryKv } from '../helpers/kv';

afterEach(() => {
  vi.unstubAllEnvs();
});

function envWith(kv: KVNamespace): Cloudflare.Env {
  return { FLAREWATCH_ADMIN_BASIC_AUTH: 'configured', FLAREWATCH_STATE: kv };
}

function requestWithCookie(cookie?: string): Request {
  return new Request('https://status.test/', cookie ? { headers: { Cookie: cookie } } : {});
}

const VALID_SESSION = JSON.stringify({
  createdAt: 123,
  ip: '127.0.0.1',
  identity: await passwordIdentity('configured'),
});

describe('resolveViewer', () => {
  it('recognizes the operator from a URL-encoded session cookie among other cookies', async () => {
    const kv = memoryKv({ 'admin_session:session=abc+123': VALID_SESSION });
    const request = requestWithCookie(
      'theme=dark; flarewatch_admin_session=session%3Dabc%2B123; other=value',
    );

    await expect(resolveViewer(envWith(kv), request)).resolves.toBe('operator');
  });

  it('treats requests without a usable session cookie as visitors', async () => {
    const kv = memoryKv({ 'admin_session:abc': VALID_SESSION });

    for (const cookie of [undefined, 'malformed; theme=dark', 'flarewatch_admin_session=forged']) {
      await expect(resolveViewer(envWith(kv), requestWithCookie(cookie))).resolves.toBe('visitor');
    }
  });

  it('treats malformed session records as visitors', async () => {
    const records = [
      '{bad json',
      '{}',
      '[]',
      '"session"',
      '{"ip":"127.0.0.1"}',
      '{"createdAt":"123","ip":null}',
      '{"createdAt":123,"ip":5}',
      // A 1.x session, from before sessions recorded who signed in.
      '{"createdAt":123,"ip":"127.0.0.1"}',
    ];
    for (const record of records) {
      const kv = memoryKv({ 'admin_session:abc': record });
      await expect(
        resolveViewer(envWith(kv), requestWithCookie('flarewatch_admin_session=abc')),
      ).resolves.toBe('visitor');
    }
  });

  it('treats a KV failure as a visitor', async () => {
    const kv = memoryKv();
    kv.get.mockRejectedValueOnce(new Error('KV unavailable'));

    await expect(
      resolveViewer(envWith(kv), requestWithCookie('flarewatch_admin_session=abc')),
    ).resolves.toBe('visitor');
  });

  it('reads the session from KV once per request', async () => {
    const kv = memoryKv({ 'admin_session:abc': VALID_SESSION });
    const request = requestWithCookie('flarewatch_admin_session=abc');

    await resolveViewer(envWith(kv), request);
    await resolveViewer(envWith(kv), request);

    expect(kv.get).toHaveBeenCalledTimes(1);
  });

  it('opens up only in dev when sign-in is not configured', async () => {
    const kv = memoryKv({ 'admin_session:abc': VALID_SESSION });
    const env: Cloudflare.Env = { FLAREWATCH_STATE: kv };

    vi.stubEnv('DEV', true);
    await expect(resolveViewer(env, requestWithCookie())).resolves.toBe('operator');

    vi.stubEnv('DEV', false);
    await expect(
      resolveViewer(env, requestWithCookie('flarewatch_admin_session=abc')),
    ).resolves.toBe('visitor');
  });
});

describe('sessions', () => {
  it('signs the operator in until the session ends', async () => {
    const kv = memoryKv();
    const sessionId = await startSession(kv, '127.0.0.1', await passwordIdentity('configured'));
    const cookie = `flarewatch_admin_session=${encodeURIComponent(sessionId)}`;

    await expect(resolveViewer(envWith(kv), requestWithCookie(cookie))).resolves.toBe('operator');
    expect(kv.put).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      expirationTtl: 60 * 60 * 24 * 14,
    });

    await endSession(envWith(kv), requestWithCookie(cookie));
    await expect(resolveViewer(envWith(kv), requestWithCookie(cookie))).resolves.toBe('visitor');
  });

  it('ends password sessions when the admin secret changes or goes away', async () => {
    const kv = memoryKv();
    const sessionId = await startSession(kv, null, await passwordIdentity('old secret'));
    const request = () => requestWithCookie(`flarewatch_admin_session=${sessionId}`);
    const access: AccessConfig = {
      providers: [
        { id: 'pocket-id', name: 'Pocket ID', issuer: 'https://id.test', clientId: 'fw' },
      ],
    };

    await expect(resolveViewer(envWith(kv), request())).resolves.toBe('visitor');
    await expect(resolvePrincipal({ FLAREWATCH_STATE: kv }, request(), access)).resolves.toBeNull();
    await expect(
      resolvePrincipal(
        { FLAREWATCH_ADMIN_BASIC_AUTH: 'old secret', FLAREWATCH_STATE: kv },
        request(),
      ),
    ).resolves.toEqual({ role: 'operator' });
  });

  it('spends no KV delete on signing out a session that does not exist', async () => {
    const kv = memoryKv();

    await endSession(envWith(kv), requestWithCookie('flarewatch_admin_session=forged'));

    expect(kv.delete).not.toHaveBeenCalled();
  });
});

describe('session expiry errors', () => {
  it('detects session expiry errors', () => {
    expect(isSessionExpiredError(new SessionExpiredError())).toBe(true);
    expect(isSessionExpiredError(Object.assign(new Error('Unauthorized'), { status: 401 }))).toBe(
      true,
    );
    expect(isSessionExpiredError(Object.assign(new Error('Forbidden'), { status: 403 }))).toBe(
      false,
    );
  });
});

describe('provider sessions', () => {
  const access: AccessConfig = {
    providers: [{ id: 'pocket-id', name: 'Pocket ID', issuer: 'https://id.test', clientId: 'fw' }],
    members: ['kim@example.com'],
  };
  const kim: Identity = {
    kind: 'provider',
    provider: 'pocket-id',
    name: 'Kim',
    email: 'kim@example.com',
    emailVerified: true,
    groups: [],
  };
  const providerEnv = (kv: KVNamespace): Cloudflare.Env => ({ FLAREWATCH_STATE: kv });

  it('takes the role from the current config, so dropping someone ends their access', async () => {
    const kv = memoryKv();
    const cookie = `flarewatch_admin_session=${await startSession(kv, null, kim)}`;

    await expect(
      resolvePrincipal(providerEnv(kv), requestWithCookie(cookie), access),
    ).resolves.toEqual({ role: 'member', groups: 'all' });
    await expect(
      resolvePrincipal(providerEnv(kv), requestWithCookie(cookie), { ...access, members: [] }),
    ).resolves.toBeNull();
    await expect(sessionName(providerEnv(kv), requestWithCookie(cookie))).resolves.toBe('Kim');
  });

  it('treats a session whose identity is malformed as a visitor', async () => {
    const kv = memoryKv({
      'admin_session:abc': JSON.stringify({
        createdAt: 1,
        ip: null,
        identity: {
          kind: 'provider',
          provider: 'pocket-id',
          name: 'Kim',
          email: 'kim@example.com',
          emailVerified: 'yes',
          groups: [],
        },
      }),
    });

    await expect(
      resolvePrincipal(providerEnv(kv), requestWithCookie('flarewatch_admin_session=abc'), access),
    ).resolves.toBeNull();
  });
});

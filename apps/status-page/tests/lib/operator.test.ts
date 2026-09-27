import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { endSession, resolveViewer, startSession } from '@/lib/operator.server';
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

const VALID_SESSION = JSON.stringify({ createdAt: 123, ip: '127.0.0.1' });

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
    const sessionId = await startSession(kv, '127.0.0.1');
    const cookie = `flarewatch_admin_session=${encodeURIComponent(sessionId)}`;

    await expect(resolveViewer(envWith(kv), requestWithCookie(cookie))).resolves.toBe('operator');
    expect(kv.put).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      expirationTtl: 60 * 60 * 24 * 14,
    });

    await endSession(kv, requestWithCookie(cookie));
    await expect(resolveViewer(envWith(kv), requestWithCookie(cookie))).resolves.toBe('visitor');
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

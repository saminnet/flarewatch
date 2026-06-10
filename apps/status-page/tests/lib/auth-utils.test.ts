import { describe, expect, it } from 'vite-plus/test';
import { getAdminSessionCookie, timingSafeEqual, validateSession } from '../../src/lib/auth-utils';
import { isSessionExpiredError, SessionExpiredError } from '../../src/lib/query/auth.mutations';

type TestKv = Parameters<typeof validateSession>[0];

function createKv(value: string | null, shouldThrow = false): TestKv {
  return {
    get: async () => {
      if (shouldThrow) throw new Error('KV unavailable');
      return value;
    },
  } as unknown as TestKv;
}

describe('auth-utils', () => {
  it('compares strings without accepting unequal values or lengths', () => {
    expect(timingSafeEqual('secret', 'secret')).toBe(true);
    expect(timingSafeEqual('secret', 'wrong')).toBe(false);
    expect(timingSafeEqual('secret', 'secret-extra')).toBe(false);
  });

  it('extracts and decodes the admin session cookie', () => {
    const header = 'theme=dark; flarewatch_admin_session=session%3Dabc%2B123; other=value';

    expect(getAdminSessionCookie(header)).toBe('session=abc+123');
  });

  it('ignores malformed cookies and returns null when the session cookie is absent', () => {
    expect(getAdminSessionCookie('malformed; theme=dark')).toBeNull();
    expect(getAdminSessionCookie(null)).toBeNull();
  });

  it('reads valid session data from KV', async () => {
    const session = { createdAt: 123, ip: '127.0.0.1' };
    const kv = createKv(JSON.stringify(session));

    await expect(validateSession(kv, 'abc')).resolves.toEqual(session);
  });

  it('returns null for missing, invalid, or unavailable session data', async () => {
    await expect(validateSession(createKv(null), 'abc')).resolves.toBeNull();
    await expect(validateSession(createKv('{bad json'), 'abc')).resolves.toBeNull();
    await expect(validateSession(createKv(null, true), 'abc')).resolves.toBeNull();
  });

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

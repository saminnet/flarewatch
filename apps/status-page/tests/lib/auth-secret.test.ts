import { describe, expect, it } from 'vite-plus/test';
import { parseAuthSecret, verifyAuthSecret, verifyBasicAuthHeader } from '@/lib/auth-secret';

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function derivePbkdf2Hash(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    keyMaterial,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

async function buildAuthSecret(username: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePbkdf2Hash(password, salt, 100_000);
  return JSON.stringify({
    username,
    salt: bytesToBase64(salt),
    hash,
  });
}

describe('auth-secret', () => {
  it('parses hashed secret payload', async () => {
    const secret = await buildAuthSecret('status', 'secret123');
    const parsed = parseAuthSecret(secret);
    expect(parsed).toBeTruthy();
    expect(parsed?.username).toBe('status');
  });

  it('parses payload wrapped in single quotes', async () => {
    const secret = await buildAuthSecret('status', 'secret123');
    const quoted = `'${secret}'`;
    const parsed = parseAuthSecret(quoted);
    expect(parsed).toBeTruthy();
    expect(parsed?.username).toBe('status');
  });

  it('parses payload when JSON was stringified twice', async () => {
    const secret = await buildAuthSecret('status', 'secret123');
    const stringifiedTwice = JSON.stringify(secret);
    const parsed = parseAuthSecret(stringifiedTwice);
    expect(parsed).toBeTruthy();
    expect(parsed?.username).toBe('status');
  });

  it('verifies credentials when plus signs became spaces', async () => {
    const salt = new Uint8Array([0, 1, 2, 0xfb, 0xef, 0xbe, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const hash = await derivePbkdf2Hash('secret123', salt, 100_000);
    const payload = JSON.stringify({
      username: 'status',
      salt: bytesToBase64(salt),
      hash,
    });
    expect(payload).toContain('+');

    const parsed = parseAuthSecret(payload.replaceAll('+', ' '));
    expect(parsed).toBeTruthy();
    await expect(
      verifyAuthSecret(payload.replaceAll('+', ' '), 'status', 'secret123'),
    ).resolves.toBe(true);
  });

  it('rejects non-JSON secret format', () => {
    expect(parseAuthSecret('admin:password')).toBeNull();
    expect(parseAuthSecret('invalid')).toBeNull();
    expect(parseAuthSecret(':password')).toBeNull();
    expect(parseAuthSecret('admin:')).toBeNull();
  });

  it('rejects invalid secret payload', () => {
    const invalid = '{"username":"admin","salt":"not-base64"}';
    expect(parseAuthSecret(invalid)).toBeNull();
  });

  it('verifies hashed credentials', async () => {
    const secret = await buildAuthSecret('admin', 'super-secret');
    await expect(verifyAuthSecret(secret, 'admin', 'super-secret')).resolves.toBe(true);
    await expect(verifyAuthSecret(secret, 'admin', 'wrong')).resolves.toBe(false);
    await expect(verifyAuthSecret(secret, 'other', 'super-secret')).resolves.toBe(false);
  });

  it('verifies basic auth header for hashed secret', async () => {
    const secret = await buildAuthSecret('status', 'status-pass');
    const header = `Basic ${btoa('status:status-pass')}`;
    await expect(verifyBasicAuthHeader(secret, header)).resolves.toBe(true);
    await expect(verifyBasicAuthHeader(secret, `Basic ${btoa('status:wrong')}`)).resolves.toBe(
      false,
    );
    await expect(verifyBasicAuthHeader(secret, 'Bearer token')).resolves.toBe(false);
    await expect(verifyBasicAuthHeader('status:status-pass', header)).resolves.toBe(false);
  });
});

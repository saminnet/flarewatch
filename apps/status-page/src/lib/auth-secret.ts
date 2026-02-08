import { timingSafeEqual } from './auth-utils';

const AUTH_SECRET_KDF = 'pbkdf2-sha256';
const PBKDF2_HASH_BITS = 256;

export type ParsedAuthSecret = {
  username: string;
  iterations: number;
  salt: string;
  hash: string;
};

type AuthSecretPayload = {
  username: string;
  kdf: string;
  iterations: number;
  salt: string;
  hash: string;
};

function normalizeBase64(value: string): string | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = normalized.length % 4;
  const padded = remainder === 0 ? normalized : normalized + '='.repeat(4 - remainder);
  try {
    atob(padded);
    return padded;
  } catch {
    return null;
  }
}

function isValidPayload(payload: unknown): payload is AuthSecretPayload {
  if (typeof payload !== 'object' || payload === null) return false;

  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.username !== 'string' || candidate.username.length === 0) return false;
  if (candidate.kdf !== AUTH_SECRET_KDF) return false;
  if (
    typeof candidate.iterations !== 'number' ||
    !Number.isInteger(candidate.iterations) ||
    candidate.iterations < 100_000 ||
    candidate.iterations > 1_000_000
  ) {
    return false;
  }
  if (typeof candidate.salt !== 'string' || !normalizeBase64(candidate.salt)) return false;
  if (typeof candidate.hash !== 'string' || !normalizeBase64(candidate.hash)) return false;
  return true;
}

export function parseAuthSecret(rawSecret: string): ParsedAuthSecret | null {
  try {
    const payload = JSON.parse(rawSecret);
    if (!isValidPayload(payload)) return null;
    return {
      username: payload.username,
      iterations: payload.iterations,
      salt: payload.salt,
      hash: payload.hash,
    };
  } catch {
    return null;
  }
}

function parseBasicAuthHeader(
  authHeader: string | null,
): { username: string; password: string } | null {
  if (!authHeader || !authHeader.startsWith('Basic ')) return null;

  const encoded = authHeader.slice('Basic '.length).trim();
  if (!encoded) return null;

  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return null;
  }

  const idx = decoded.indexOf(':');
  if (idx <= 0 || idx === decoded.length - 1) return null;

  return {
    username: decoded.slice(0, idx),
    password: decoded.slice(idx + 1),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function derivePbkdf2Hash(
  password: string,
  saltBase64: string,
  iterations: number,
): Promise<string> {
  const normalizedSalt = normalizeBase64(saltBase64);
  if (!normalizedSalt) {
    throw new Error('Invalid salt');
  }

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: Uint8Array.from(atob(normalizedSalt), (c) => c.charCodeAt(0)),
      iterations,
    },
    keyMaterial,
    PBKDF2_HASH_BITS,
  );
  return bytesToBase64(new Uint8Array(bits));
}

export async function verifyAuthSecret(
  secretInput: string | ParsedAuthSecret,
  username: string,
  password: string,
): Promise<boolean> {
  const secret = typeof secretInput === 'string' ? parseAuthSecret(secretInput) : secretInput;
  if (!secret) return false;

  try {
    const derived = await derivePbkdf2Hash(password, secret.salt, secret.iterations);
    const expected = normalizeBase64(secret.hash);
    if (!expected) return false;

    const usernameOk = timingSafeEqual(username, secret.username);
    const passwordOk = timingSafeEqual(derived, expected);
    return usernameOk && passwordOk;
  } catch {
    return false;
  }
}

export async function verifyBasicAuthHeader(
  secretInput: string | ParsedAuthSecret,
  authHeader: string | null,
): Promise<boolean> {
  const credentials = parseBasicAuthHeader(authHeader);
  if (!credentials) return false;
  return verifyAuthSecret(secretInput, credentials.username, credentials.password);
}

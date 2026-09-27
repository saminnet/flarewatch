import { isJsonObject, isNonEmptyString, timingSafeEqual } from '@flarewatch/shared';

const encoder = new TextEncoder();

/** Lives from the redirect to the provider until its callback: ten minutes. */
export const FLOW_TTL_SECONDS = 600;

/** What the sign-in start hands to its callback, in a signed cookie instead of storage. */
export type SignInFlow = {
  provider: string;
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  /** Unix timestamp (seconds) */
  expiresAt: number;
};

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function fromBase64Url(value: string): string | null {
  try {
    return atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  } catch {
    return null;
  }
}

export function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return base64Url(new Uint8Array(digest));
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
}

export async function sealFlow(secret: string, flow: SignInFlow): Promise<string> {
  const payload = base64Url(encoder.encode(JSON.stringify(flow)));
  return `${payload}.${await sign(secret, payload)}`;
}

function isSignInFlow(value: unknown): value is SignInFlow {
  return (
    isJsonObject(value) &&
    isNonEmptyString(value.provider) &&
    isNonEmptyString(value.state) &&
    isNonEmptyString(value.nonce) &&
    isNonEmptyString(value.verifier) &&
    isNonEmptyString(value.returnTo) &&
    typeof value.expiresAt === 'number'
  );
}

/** Null when the cookie was not signed with this secret, or has expired. */
export async function openFlow(
  secret: string,
  sealed: string,
  nowSeconds: number,
): Promise<SignInFlow | null> {
  const [payload, signature, ...rest] = sealed.split('.');
  if (!payload || !signature || rest.length > 0) return null;
  if (!timingSafeEqual(await sign(secret, payload), signature)) return null;
  const json = fromBase64Url(payload);
  if (json === null) return null;
  let flow: unknown;
  try {
    flow = JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
  return isSignInFlow(flow) && flow.expiresAt > nowSeconds ? flow : null;
}

/**
 * Only a path on this site, so the sign-in cannot send someone elsewhere.
 * Parsed the way a browser would: it drops tabs and newlines and reads a
 * backslash as a slash, which can turn a path into another host.
 */
export function safeReturnTo(value: string | null): string {
  const base = 'https://flarewatch.invalid';
  if (!value?.startsWith('/') || !URL.canParse(value, base)) return '/';
  const url = new URL(value, base);
  return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : '/';
}

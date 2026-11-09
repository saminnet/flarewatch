import * as z from 'zod/mini';
import { timingSafeEqual } from '@flarewatch/shared';

export type SubscriberAction = 'confirm' | 'unsubscribe';
const encoder = new TextEncoder();

export function normalizeSubscriberEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && z.email().safeParse(email).success ? email : null;
}

async function signature(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`subscribers:v1:${value}`));
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function subscriberToken(
  secret: string,
  action: SubscriberAction,
  email: string,
  generation = '0',
): Promise<string> {
  const value = `${action}:${encodeURIComponent(email)}:${generation}`;
  return `${value}:${await signature(secret, value)}`;
}

export async function verifySubscriberToken(
  secret: string,
  action: SubscriberAction,
  token: string,
): Promise<{ email: string; generation: string } | null> {
  if (token.length > 1200) return null;
  const parts = token.split(':');
  if (parts.length !== 4 || parts[0] !== action) return null;
  const [, address, generation, mac] = parts;
  if (!address || !generation || !mac) return null;
  const expected = await signature(secret, `${action}:${address}:${generation}`);
  if (!timingSafeEqual(expected, mac)) return null;
  try {
    const email = normalizeSubscriberEmail(decodeURIComponent(address));
    return email ? { email, generation } : null;
  } catch {
    return null;
  }
}

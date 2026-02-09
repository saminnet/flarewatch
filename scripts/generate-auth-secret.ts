#!/usr/bin/env node

export {};

declare const process: { argv: string[]; exit: (code: number) => never };

const DEFAULT_ITERATIONS = 100_000;

const args = process.argv.slice(2);
const effectiveArgs = args[0] === '--' ? args.slice(1) : args;
const [username, password, extra] = effectiveArgs;

if (!username || !password || extra !== undefined) {
  console.error('Usage: pnpm auth:secret -- <username> <password>');
  process.exit(1);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

const salt = crypto.getRandomValues(new Uint8Array(16));

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
    salt,
    iterations: DEFAULT_ITERATIONS,
  },
  keyMaterial,
  256,
);

const payload = {
  username,
  salt: bytesToBase64Url(salt),
  hash: bytesToBase64Url(new Uint8Array(bits)),
};

console.log(JSON.stringify(payload));

import type { JsonObject } from '@flarewatch/shared';

/** An unsigned ID token: the sign-in reads its claims and trusts the token endpoint's TLS. */
export function idToken(claims: JsonObject, header: JsonObject = { alg: 'none' }): string {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replaceAll('=', '');
  return `${encode(header)}.${encode(claims)}.signature`;
}

export function discovery(issuer: string, scopes?: string[]): Response {
  return Response.json({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    ...(scopes && { scopes_supported: scopes }),
  });
}

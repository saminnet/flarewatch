import {
  isJsonObject,
  isNonEmptyString,
  isSecureUrl,
  type AuthProvider,
  type JsonObject,
} from '@flarewatch/shared';
import type { Identity } from './access';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A sign-in that failed for a reason the person can be told. */
export class SignInError extends Error {}

type Discovery = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
};

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';
const GITHUB_API = 'https://api.github.com';

const discoveries = new Map<string, Promise<Discovery>>();

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

async function readBody(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    return null;
  }
}

async function readJson(response: Response, what: string): Promise<JsonObject> {
  if (!response.ok) throw new SignInError(`${what} answered ${response.status}`);
  const body = await readBody(response);
  if (!isJsonObject(body)) throw new SignInError(`${what} sent no JSON object`);
  return body;
}

async function fetchDiscovery(issuer: string, fetchFn: Fetch): Promise<Discovery> {
  const body = await readJson(
    await fetchFn(`${trimSlash(issuer)}/.well-known/openid-configuration`),
    'The provider discovery document',
  );
  const {
    authorization_endpoint: authorize,
    token_endpoint: token,
    scopes_supported: scopes,
  } = body;
  if (
    typeof body.issuer !== 'string' ||
    trimSlash(body.issuer) !== trimSlash(issuer) ||
    !isNonEmptyString(authorize) ||
    !isNonEmptyString(token) ||
    // The ID token is trusted for coming over TLS from the token endpoint.
    !isSecureUrl(token) ||
    !isSecureUrl(authorize)
  ) {
    throw new SignInError('The provider discovery document does not match its issuer');
  }
  return {
    issuer: body.issuer,
    authorizationEndpoint: authorize,
    tokenEndpoint: token,
    scopes: Array.isArray(scopes) ? scopes.filter((scope) => typeof scope === 'string') : [],
  };
}

/** Cached per isolate once it succeeds. */
function discover(issuer: string, fetchFn: Fetch): Promise<Discovery> {
  let discovery = discoveries.get(issuer);
  if (!discovery) {
    discovery = fetchDiscovery(issuer, fetchFn);
    discoveries.set(issuer, discovery);
    discovery.catch(() => discoveries.delete(issuer));
  }
  return discovery;
}

type AuthorizeInput = { redirectUri: string; state: string; nonce: string; challenge: string };

export async function authorizationUrl(
  provider: AuthProvider,
  input: AuthorizeInput,
  fetchFn: Fetch,
): Promise<string> {
  const github = provider.type === 'github';
  const discovery = github ? null : await discover(provider.issuer, fetchFn);
  const url = new URL(discovery?.authorizationEndpoint ?? GITHUB_AUTHORIZE);
  const scopes = github
    ? ['read:user', 'user:email']
    : ['openid', 'email', 'profile', ...(discovery?.scopes.includes('groups') ? ['groups'] : [])];
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: provider.clientId,
    redirect_uri: input.redirectUri,
    scope: scopes.join(' '),
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    ...(github ? { allow_signup: 'false' } : { nonce: input.nonce }),
  }).toString();
  return url.toString();
}

type CallbackInput = {
  code: string;
  redirectUri: string;
  verifier: string;
  nonce: string;
  clientSecret: string | undefined;
  nowSeconds: number;
};

function tokenRequest(provider: AuthProvider, input: CallbackInput): RequestInit {
  return {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: provider.clientId,
      code_verifier: input.verifier,
      ...(input.clientSecret !== undefined && { client_secret: input.clientSecret }),
    }).toString(),
  };
}

function jwtClaims(token: string): JsonObject {
  const payload = token.split('.')[1];
  if (!payload) throw new SignInError('The provider sent a malformed ID token');
  try {
    const json = atob(payload.replaceAll('-', '+').replaceAll('_', '/'));
    const claims: unknown = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0))),
    );
    if (isJsonObject(claims)) return claims;
  } catch {}
  throw new SignInError('The provider sent a malformed ID token');
}

/**
 * The ID token comes straight from the token endpoint over TLS, which OpenID
 * Connect Core 3.1.3.7 allows in place of checking its signature. Issuer,
 * audience, expiry and nonce are still checked.
 */
async function identifyOidc(
  provider: Extract<AuthProvider, { issuer: string }>,
  input: CallbackInput,
  fetchFn: Fetch,
): Promise<Identity> {
  const discovery = await discover(provider.issuer, fetchFn);
  const tokens = await readJson(
    await fetchFn(discovery.tokenEndpoint, tokenRequest(provider, input)),
    'The provider token endpoint',
  );
  if (!isNonEmptyString(tokens.id_token)) throw new SignInError('The provider sent no ID token');
  const claims = jwtClaims(tokens.id_token);

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    claims.iss !== discovery.issuer ||
    !audiences.includes(provider.clientId) ||
    (audiences.length > 1 && claims.azp !== provider.clientId) ||
    typeof claims.exp !== 'number' ||
    claims.exp <= input.nowSeconds ||
    claims.nonce !== input.nonce
  ) {
    throw new SignInError('The provider sent an ID token for a different sign-in');
  }

  const email = isNonEmptyString(claims.email) ? claims.email : undefined;
  const groups = Array.isArray(claims.groups)
    ? claims.groups.filter((group) => typeof group === 'string')
    : [];
  const name = [claims.name, claims.preferred_username, email, claims.sub].find(isNonEmptyString);
  return {
    kind: 'provider',
    provider: provider.id,
    name: name ?? provider.name,
    ...(email !== undefined && { email }),
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    groups,
  };
}

async function identifyGithub(
  provider: AuthProvider,
  input: CallbackInput,
  fetchFn: Fetch,
): Promise<Identity> {
  const tokens = await readJson(
    await fetchFn(GITHUB_TOKEN, tokenRequest(provider, input)),
    'GitHub',
  );
  if (!isNonEmptyString(tokens.access_token)) throw new SignInError('GitHub sent no access token');
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${tokens.access_token}`,
    'User-Agent': 'FlareWatch',
  };
  const user = await readJson(await fetchFn(`${GITHUB_API}/user`, { headers }), 'GitHub');
  if (!isNonEmptyString(user.login)) throw new SignInError('GitHub sent no login');

  const emailsResponse = await fetchFn(`${GITHUB_API}/user/emails`, { headers });
  const emails = emailsResponse.ok ? await readBody(emailsResponse) : null;
  const list: unknown[] = Array.isArray(emails) ? emails : [];
  const primary = list.find(
    (entry) => isJsonObject(entry) && entry.primary === true && entry.verified === true,
  );
  const email =
    isJsonObject(primary) && isNonEmptyString(primary.email) ? primary.email : undefined;

  return {
    kind: 'provider',
    provider: provider.id,
    name: isNonEmptyString(user.name) ? user.name : user.login,
    ...(email !== undefined && { email }),
    emailVerified: email !== undefined,
    groups: [],
    githubLogin: user.login,
  };
}

export function identify(
  provider: AuthProvider,
  input: CallbackInput,
  fetchFn: Fetch,
): Promise<Identity> {
  return provider.type === 'github'
    ? identifyGithub(provider, input, fetchFn)
    : identifyOidc(provider, input, fetchFn);
}

// A stand-in OpenID Connect provider for the browser tests. Its sign-in page
// lists the test people; picking one returns to the status page with a code.
import { createServer } from 'node:http';

const port = Number(process.env.FAKE_OIDC_PORT ?? 3102);
const issuer = `http://127.0.0.1:${port}`;
const people = ['operator@e2e.test', 'member@e2e.test', 'partner@e2e.test', 'stranger@e2e.test'];
const codes = new Map<string, { email: string; nonce: string }>();

const encode = (value: unknown) =>
  btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

createServer((request, response) => {
  const url = new URL(request.url ?? '/', issuer);

  if (url.pathname === '/.well-known/openid-configuration') {
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        scopes_supported: ['openid', 'email', 'profile', 'groups'],
      }),
    );
    return;
  }

  if (url.pathname === '/authorize') {
    const back = new URL(url.searchParams.get('redirect_uri') ?? '/');
    const links = people.map((email) => {
      const code = crypto.randomUUID();
      codes.set(code, { email, nonce: url.searchParams.get('nonce') ?? '' });
      back.search = new URLSearchParams({
        code,
        state: url.searchParams.get('state') ?? '',
      }).toString();
      return `<li><a href="${back.toString()}">${email}</a></li>`;
    });
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><title>Test ID</title><h1>Test ID</h1><ul>${links.join('')}</ul>`);
    return;
  }

  if (url.pathname === '/token' && request.method === 'POST') {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      const grant = codes.get(new URLSearchParams(body).get('code') ?? '');
      response.setHeader('Content-Type', 'application/json');
      if (!grant) {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      const claims = {
        iss: issuer,
        aud: 'flarewatch-e2e',
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce: grant.nonce,
        sub: grant.email,
        email: grant.email,
        email_verified: true,
        name: grant.email.split('@')[0],
      };
      response.end(JSON.stringify({ id_token: `${encode({ alg: 'none' })}.${encode(claims)}.x` }));
    });
    return;
  }

  response.statusCode = 404;
  response.end('not found');
}).listen(port, '127.0.0.1');

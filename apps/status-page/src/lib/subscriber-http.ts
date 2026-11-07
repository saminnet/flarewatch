import { isJsonObject, readTextUpTo } from '@flarewatch/shared';
import { getConfig, isPrivateOnly } from './config';
import { resolveRuntimeEnv } from './runtime-env';
import { clientIp } from './operator.server';
import { actOnSubscriber, submitSubscriber } from './monitor-worker';
import { escapeXml } from './xml';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

export async function handleSubscription(
  request: Request,
  action: 'subscribe' | 'confirm' | 'unsubscribe',
): Promise<Response> {
  const env = await resolveRuntimeEnv();
  if (!env.SUBSCRIBE_RATE_LIMIT)
    return new Response('Subscriptions are unavailable', { status: 503, headers: HEADERS });
  const url = new URL(request.url);
  const token = url.searchParams.get('token') ?? '';
  // Mail providers send one-click POSTs from shared addresses, so each link has its own limit.
  const key = (action === 'unsubscribe' && token) || (clientIp(request) ?? 'unknown');
  if (!(await env.SUBSCRIBE_RATE_LIMIT.limit({ key })).success)
    return new Response('Too many attempts. Try again in a minute.', {
      status: 429,
      headers: HEADERS,
    });
  // Mail scanners open links, so a GET only shows the button.
  if (action === 'unsubscribe' && request.method === 'GET')
    return actionPage(
      url,
      'Unsubscribe from incident emails',
      'Unsubscribe',
      '<input type="hidden" name="List-Unsubscribe" value="One-Click">',
    );
  if (action === 'confirm' && request.method === 'GET')
    return actionPage(url, 'Confirm your subscription', 'Confirm', '');
  try {
    if (request.method !== 'POST')
      return new Response('Method Not Allowed', { status: 405, headers: HEADERS });
    const body = await readTextUpTo(request, 4097);
    if (new TextEncoder().encode(body).length > 4096)
      return new Response('Payload Too Large', { status: 413, headers: HEADERS });
    if (action === 'confirm') return withHeaders(await actOnSubscriber('confirm', token));
    const fields = await readFields(body, request.headers.get('Content-Type'));
    if (action === 'unsubscribe') {
      if (fields.get('List-Unsubscribe') !== 'One-Click')
        return new Response('Invalid unsubscribe request', { status: 400, headers: HEADERS });
      return withHeaders(await actOnSubscriber('unsubscribe', token));
    }
    const config = getConfig();
    if (!config.statusPage?.subscribers || isPrivateOnly(config))
      return new Response('Not Found', { status: 404, headers: HEADERS });
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin)
      return new Response('Invalid origin', { status: 403, headers: HEADERS });
    if (env.TURNSTILE_SECRET) {
      const token = fields.get('cf-turnstile-response');
      if (!token || token.length > 2048)
        return new Response('Complete the verification', { status: 400, headers: HEADERS });
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        redirect: 'manual',
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET,
          response: token,
          remoteip: clientIp(request) ?? '',
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const result: unknown = await response.json();
      if (
        !response.ok ||
        !isJsonObject(result) ||
        result.success !== true ||
        result.hostname !== url.hostname
      )
        return new Response('Verification failed. Try again.', { status: 400, headers: HEADERS });
    }
    const response = await submitSubscriber(fields.get('email') ?? '');
    return response.ok
      ? new Response('Check your inbox.', { headers: HEADERS })
      : withHeaders(response);
  } catch (error) {
    console.error('Subscription request failed', { cause: String(error) });
    return new Response('Subscriptions are unavailable. Try again later.', {
      status: 503,
      headers: HEADERS,
    });
  }
}

function actionPage(url: URL, heading: string, button: string, field: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${button}</title><main><h1>${heading}</h1><form method="post" action="${escapeXml(url.pathname + url.search)}">${field}<button type="submit">${button}</button></form><p><a href="/">Back to status page</a></p></main></html>`,
    { headers: { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

/** RFC 8058 clients should send multipart/form-data and can send a URL-encoded form. */
async function readFields(body: string, contentType: string | null): Promise<URLSearchParams> {
  if (!contentType?.toLowerCase().startsWith('multipart/form-data'))
    return new URLSearchParams(body);
  const form = await new Response(body, { headers: { 'Content-Type': contentType } })
    .formData()
    .catch(() => new FormData());
  return new URLSearchParams(
    [...form].flatMap(([name, value]) => (typeof value === 'string' ? [[name, value]] : [])),
  );
}

function withHeaders(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

import { isJsonObject, readJsonUpTo, type PageConfig } from '@flarewatch/shared';
import { getHub, type Env } from './env';
import { normalizeSubscriberEmail, verifySubscriberToken } from './subscriber-tokens';

export async function handleSubscriberRequest(
  request: Request,
  env: Env,
  page: PageConfig | undefined,
): Promise<Response> {
  const url = new URL(request.url);
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  const hub = getHub(env);
  if (url.pathname === '/subscribers/count' && request.method === 'GET') {
    return Response.json({ count: await hub.subscriberCount() }, { headers });
  }
  if (!env.SUBSCRIBER_SECRET)
    return new Response('Subscribers are not configured', { status: 503, headers });
  if (url.pathname === '/subscribers' && request.method === 'POST') {
    if (!page?.subscribers || page.visibility === 'private')
      return new Response('Not Found', { status: 404, headers });
    if (
      !(page.subscribers.provider === 'cloudflare' ? env.SUBSCRIBER_EMAIL : env.RESEND_API_KEY) ||
      !env.PUBLIC_ORIGIN
    )
      return new Response('Subscribers are not configured', { status: 503, headers });
    const body = await readJsonUpTo(request, 4096).catch(() => null);
    const email = normalizeSubscriberEmail(isJsonObject(body) ? body.email : null);
    if (!email) return new Response('Enter a valid email address', { status: 400, headers });
    await hub.subscribe(
      email,
      Math.floor(Date.now() / 1000),
      page.subscribers.maxSubscribers ?? 200,
    );
    return new Response('Check your inbox.', { headers });
  }
  const action =
    url.pathname === '/subscribers/confirm'
      ? 'confirm'
      : url.pathname === '/subscribers/unsubscribe'
        ? 'unsubscribe'
        : null;
  if (!action || request.method !== 'POST')
    return new Response('Not Found', { status: 404, headers });
  const token = await verifySubscriberToken(
    env.SUBSCRIBER_SECRET,
    action,
    url.searchParams.get('token') ?? '',
  );
  if (!token) return new Response('Invalid link', { status: 400, headers });
  if (action === 'confirm') {
    const confirmed = await hub.confirmSubscriber(
      token.email,
      token.generation,
      Math.floor(Date.now() / 1000),
    );
    return new Response(
      confirmed
        ? 'Subscription confirmed.'
        : 'This confirmation link has expired. Subscribe again.',
      { status: confirmed ? 200 : 400, headers },
    );
  }
  await hub.unsubscribe(token.email);
  return new Response('Unsubscribed.', { headers });
}

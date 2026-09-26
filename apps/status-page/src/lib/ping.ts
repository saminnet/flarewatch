import { resolveRuntimeEnv } from './runtime-env';

export const PING_RESPONSE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
} satisfies Record<string, string>;

/**
 * Forward a ping request to the monitoring worker over the MONITOR_WORKER
 * service binding. Method, path, and body pass through verbatim; headers are
 * dropped so cookies and auth headers never reach the monitoring worker.
 */
export async function forwardPing(request: Request): Promise<Response> {
  const env = await resolveRuntimeEnv();
  const monitorWorker = env.MONITOR_WORKER;
  if (!monitorWorker || typeof monitorWorker.fetch !== 'function') {
    return new Response('Not Found', { status: 404, headers: PING_RESPONSE_HEADERS });
  }

  try {
    // Streamed, not buffered: the monitoring worker caps the body after it checks the token.
    const forwarded = new Request(request, { headers: {} });
    return await monitorWorker.fetch(forwarded);
  } catch (error) {
    console.warn('Failed to forward ping', { error: String(error) });
    return new Response('Not Found', { status: 404, headers: PING_RESPONSE_HEADERS });
  }
}

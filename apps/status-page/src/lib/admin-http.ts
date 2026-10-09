import { readJsonUpTo } from '@flarewatch/shared';

export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const MAX_BODY_BYTES = 64 * 1024;

export function readBody(request: Request): Promise<unknown> {
  return readJsonUpTo(request, MAX_BODY_BYTES).catch(() => null);
}

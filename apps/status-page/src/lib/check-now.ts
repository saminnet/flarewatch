import {
  isCheckResultWithLocation,
  isJsonObject,
  type CheckResultWithLocation,
} from '@flarewatch/shared';

/** Runs one check of a monitor for the signed-in operator; the error carries the server's reason. */
export async function requestCheckNow(id: string): Promise<CheckResultWithLocation> {
  const response = await fetch('/api/admin/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = isJsonObject(body) && typeof body.error === 'string' ? body.error : null;
    throw new Error(reason ?? `Check failed (${response.status})`);
  }
  if (!isCheckResultWithLocation(body)) throw new Error('Unexpected response shape');
  return body;
}

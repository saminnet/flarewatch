import { type QueryClient } from '@tanstack/react-query';
import { isJsonObject } from '@flarewatch/shared';
import { qk } from './keys';
import { SessionExpiredError } from './auth.mutations';

export type MutationCallbacks<T = unknown> = {
  onSuccess?: (result: T) => void;
  onError?: (error: Error) => void;
};

export async function requestOk(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(path, init);
  if (!res.ok) {
    if (res.status === 401) {
      throw new SessionExpiredError();
    }
    const body: unknown = await res
      .clone()
      .json()
      .catch(() => null);
    const text = await res.text().catch(() => '');
    throw new Error(
      isJsonObject(body) && typeof body.error === 'string'
        ? body.error
        : text || `Request failed (${res.status})`,
    );
  }
  return res;
}

export function reportError(
  queryClient: QueryClient,
  error: unknown,
  onError?: (error: Error) => void,
): void {
  // Otherwise the cached session still says operator and /login sends the user back.
  if (error instanceof SessionExpiredError) queryClient.removeQueries({ queryKey: qk.session });
  onError?.(error instanceof Error ? error : new Error('Something went wrong'));
}

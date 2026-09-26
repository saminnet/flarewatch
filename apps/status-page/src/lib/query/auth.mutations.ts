import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { isJsonObject } from '@flarewatch/shared';
import { qk } from './keys';

type LoginCredentials = {
  username: string;
  password: string;
};

type LoginResult = {
  ok: boolean;
};

export class SessionExpiredError extends Error {
  readonly status = 401;
  constructor() {
    super('Session expired');
    this.name = 'SessionExpiredError';
  }
}

export function useSignIn(options?: { onError?: (error: Error) => void }) {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async (credentials: LoginCredentials): Promise<LoginResult> => {
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(credentials),
      });

      if (!res.ok) {
        const payload: unknown = await res.json().catch(() => null);
        const message =
          isJsonObject(payload) && typeof payload.error === 'string' ? payload.error : undefined;
        throw new Error(message ?? 'Sign-in failed');
      }

      return { ok: true };
    },
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: qk.session });
      await router.invalidate();
    },
    onError: options?.onError,
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: async (): Promise<void> => {
      await fetch('/api/admin/session', { method: 'DELETE' });
    },
    // Even when the request fails, drop the operator view from this tab. The
    // operator snapshot goes last: the page still reads it until it reloads.
    onSettled: async () => {
      queryClient.removeQueries({ queryKey: qk.session });
      await router.navigate({ to: '.', search: (prev) => ({ ...prev, view: undefined }) });
      queryClient.removeQueries({ queryKey: qk.operatorSnapshot });
    },
  });
}

export function isSessionExpiredError(error: unknown): boolean {
  return error instanceof Error && 'status' in error && error.status === 401;
}

/** The message to show when an operator-only request fails. */
export function mutationErrorMessage(error: Error): string {
  return isSessionExpiredError(error)
    ? 'Your session has expired. Sign in again to save changes.'
    : error.message;
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
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

export function useAdminLogin(options?: {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}) {
  const queryClient = useQueryClient();

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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.operatorSnapshot });
      options?.onSuccess?.();
    },
    onError: options?.onError,
  });
}

export function useAdminLogout(options?: {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<void> => {
      await fetch('/api/admin/session', { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: qk.operatorSnapshot });
      options?.onSuccess?.();
    },
    onError: options?.onError,
  });
}

export function isSessionExpiredError(error: unknown): boolean {
  return error instanceof Error && 'status' in error && error.status === 401;
}

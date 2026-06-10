import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { qk } from './keys';

type LoginCredentials = {
  username: string;
  password: string;
};

type LoginResult = {
  ok: boolean;
};

/** Error thrown when a 401 response is received, indicating session expiry */
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
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (credentials: LoginCredentials): Promise<LoginResult> => {
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(credentials),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? t('admin.loginFailed'));
      }

      return { ok: true };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.publicMonitors });
      void queryClient.invalidateQueries({ queryKey: qk.maintenances });
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
      void queryClient.invalidateQueries({ queryKey: qk.publicMonitors });
      void queryClient.invalidateQueries({ queryKey: qk.maintenances });
      options?.onSuccess?.();
    },
    onError: options?.onError,
  });
}

/**
 * Check if an error indicates session expiry (401 response).
 * Components can use this to redirect to login on stale auth state.
 */
export function isSessionExpiredError(error: unknown): boolean {
  if (error instanceof SessionExpiredError) return true;
  if (
    error instanceof Error &&
    'status' in error &&
    (error as Error & { status: number }).status === 401
  )
    return true;
  return false;
}

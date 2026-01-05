import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

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
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  });
}

export function useAdminLogout(options?: {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}) {
  return useMutation({
    mutationFn: async (): Promise<void> => {
      await fetch('/api/admin/session', { method: 'DELETE' });
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  });
}

/**
 * Check if an error indicates session expiry (401 response).
 * Components can use this to redirect to login on stale auth state.
 */
export function isSessionExpiredError(error: unknown): boolean {
  return error instanceof SessionExpiredError && error.status === 401;
}

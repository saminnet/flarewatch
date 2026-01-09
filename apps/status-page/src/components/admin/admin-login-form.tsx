import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { IconArrowLeft, IconLock } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Field, FieldLabel } from '@/components/ui/field';
import { PAGE_CONTAINER_CLASSES } from '@/lib/constants';
import { useAdminLogin } from '@/lib/query/auth.mutations';

type AdminLoginFormProps = {
  onLoginSuccess: () => void;
};

export function AdminLoginForm({ onLoginSuccess }: AdminLoginFormProps) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const loginMutation = useAdminLogin({
    onSuccess: () => {
      setPassword('');
      onLoginSuccess();
    },
    onError: (error) => {
      setLoginError(error.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password || loginMutation.isPending) return;
    setLoginError(null);
    loginMutation.mutate({ username, password });
  };

  return (
    <div className={PAGE_CONTAINER_CLASSES}>
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-4 text-center">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            {t('admin.signInTitle')}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">{t('admin.signInSubtitle')}</p>
        </div>

        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 shadow-sm">
          {loginError && (
            <Alert variant="destructive" className="mb-6" id="login-error" role="alert">
              <AlertDescription>{loginError}</AlertDescription>
            </Alert>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <Field>
              <FieldLabel htmlFor="username">{t('field.username')}</FieldLabel>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                aria-describedby={loginError ? 'login-error' : undefined}
                aria-invalid={!!loginError}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">{t('field.password')}</FieldLabel>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                aria-describedby={loginError ? 'login-error' : undefined}
                aria-invalid={!!loginError}
              />
            </Field>

            <Button
              type="submit"
              disabled={!username || !password || loginMutation.isPending}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white"
            >
              <IconLock className="mr-2 size-4" />
              {loginMutation.isPending ? t('action.signingIn') : t('action.signIn')}
            </Button>
          </form>
        </div>

        <div className="mt-6 text-center">
          <Link to="/">
            <Button variant="ghost" size="sm">
              <IconArrowLeft className="mr-2 h-4 w-4" />
              {t('action.goBack')}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

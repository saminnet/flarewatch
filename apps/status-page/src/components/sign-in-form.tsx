import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { IconArrowLeft, IconLock } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Field, FieldLabel } from '@/components/ui/field';
import { PAGE_CONTAINER_CLASSES } from '@/lib/constants';
import { useSignIn } from '@/lib/query/auth.mutations';

export function SignInForm({ privateOnly }: { privateOnly: boolean }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const loginMutation = useSignIn({
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
          <h1 className="text-2xl font-bold text-foreground">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {privateOnly ? 'This status page is private.' : 'For the operator of this status page.'}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          {loginError && (
            <Alert variant="destructive" className="mb-6" id="login-error" role="alert">
              <AlertDescription>{loginError}</AlertDescription>
            </Alert>
          )}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <Field>
              <FieldLabel htmlFor="username">Username</FieldLabel>
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
              <FieldLabel htmlFor="password">Password</FieldLabel>
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
              className="w-full"
            >
              <IconLock className="mr-2 size-4" />
              {loginMutation.isPending ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </div>

        {!privateOnly && (
          <div className="mt-6 text-center">
            <Link to="/" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              <IconArrowLeft />
              Go back
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

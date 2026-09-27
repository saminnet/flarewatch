import { createFileRoute, redirect } from '@tanstack/react-router';
import { IconLock } from '@tabler/icons-react';
import { SignInForm } from '@/components/sign-in-form';
import { EmptyState } from '@/components/ui/empty-state';
import { PAGE_CONTAINER_CLASSES } from '@/lib/constants';

export const Route = createFileRoute('/login')({
  validateSearch: (search): { error?: string } =>
    typeof search.error === 'string' ? { error: search.error } : {},
  beforeLoad: ({ context }) => {
    if (context.session.viewer !== 'visitor') throw redirect({ to: '/' });
  },
  component: LoginPage,
});

function LoginPage() {
  const { session } = Route.useRouteContext();

  if (!session.canSignIn) {
    return (
      <div className={PAGE_CONTAINER_CLASSES}>
        <EmptyState
          icon={IconLock}
          title={session.privateOnly ? 'This status page is private' : 'Sign-in is not set up'}
          description="Add a sign-in provider in packages/config/src/access.ts, or set FLAREWATCH_ADMIN_BASIC_AUTH on the status page worker."
        />
      </div>
    );
  }

  return (
    <SignInForm
      privateOnly={session.privateOnly}
      passwordSignIn={session.passwordSignIn}
      providers={session.providers}
      error={Route.useSearch().error}
    />
  );
}

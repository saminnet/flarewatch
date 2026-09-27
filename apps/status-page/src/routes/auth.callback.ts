import { createFileRoute } from '@tanstack/react-router';
import { finishSignIn } from '@/lib/auth/sign-in.server';
import { resolveRuntimeEnv } from '@/lib/runtime-env';

export const Route = createFileRoute('/auth/callback')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        finishSignIn(request, { env: await resolveRuntimeEnv() }),
    },
  },
});

import { createFileRoute } from '@tanstack/react-router';
import { startSignIn } from '@/lib/auth/sign-in.server';
import { resolveRuntimeEnv } from '@/lib/runtime-env';

export const Route = createFileRoute('/auth/$provider')({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { provider: string } }) =>
        startSignIn(request, params.provider, { env: await resolveRuntimeEnv() }),
    },
  },
});

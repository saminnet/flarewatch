import { createFileRoute } from '@tanstack/react-router';
import { forwardPing } from '@/lib/monitor-worker';

async function handle({ request }: { request: Request }): Promise<Response> {
  return forwardPing(request);
}

export const Route = createFileRoute('/ping/$')({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      HEAD: handle,
    },
  },
});

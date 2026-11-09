import { createFileRoute } from '@tanstack/react-router';
import { handleSubscription } from '@/lib/subscriber-http';

export const Route = createFileRoute('/subscribe/confirm')({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => handleSubscription(request, 'confirm'),
      POST: ({ request }: { request: Request }) => handleSubscription(request, 'confirm'),
    },
  },
});

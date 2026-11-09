import { createFileRoute } from '@tanstack/react-router';
import { handleSubscription } from '@/lib/subscriber-http';

export const Route = createFileRoute('/subscribe/unsubscribe')({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) => handleSubscription(request, 'unsubscribe'),
      POST: ({ request }: { request: Request }) => handleSubscription(request, 'unsubscribe'),
    },
  },
});

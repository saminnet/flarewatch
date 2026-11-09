import { createFileRoute } from '@tanstack/react-router';
import { handleSubscription } from '@/lib/subscriber-http';

export const Route = createFileRoute('/subscribe')({
  server: {
    handlers: {
      POST: ({ request }: { request: Request }) => handleSubscription(request, 'subscribe'),
    },
  },
});

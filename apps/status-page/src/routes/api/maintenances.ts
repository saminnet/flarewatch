import { createFileRoute } from '@tanstack/react-router';
import { getMaintenances } from '@/lib/kv';
import { getCorsHeaders } from '@/lib/cors';

export const Route = createFileRoute('/api/maintenances')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const corsHeaders = getCorsHeaders(request);
        try {
          const maintenances = await getMaintenances();
          return Response.json(maintenances, { headers: corsHeaders });
        } catch (error) {
          console.error('Error in /api/maintenances:', error);
          return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      },

      OPTIONS: async ({ request }: { request: Request }) => {
        const corsHeaders = getCorsHeaders(request);
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        });
      },
    },
  },
});

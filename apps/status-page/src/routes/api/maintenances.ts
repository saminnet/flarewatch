import { createFileRoute } from '@tanstack/react-router';
import { getMaintenances } from '@/lib/kv';
import { getCorsHeaders } from '@/lib/cors';
import { getConfig } from '@/lib/config';

export const Route = createFileRoute('/api/maintenances')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const config = await getConfig();
        const corsHeaders = getCorsHeaders(request, config.statusPage?.apiCorsOrigins);
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
        const config = await getConfig();
        const corsHeaders = getCorsHeaders(request, config.statusPage?.apiCorsOrigins);
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        });
      },
    },
  },
});

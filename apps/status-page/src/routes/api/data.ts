import { createFileRoute } from '@tanstack/react-router';
import { getMonitorState } from '@/lib/kv';
import { getCorsHeaders } from '@/lib/cors';
import { getConfig } from '@/lib/config';
import { projectPublicData } from '@/lib/status-projection';

export const Route = createFileRoute('/api/data')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const config = await getConfig();
        const corsHeaders = getCorsHeaders(request, config.statusPage?.apiCorsOrigins);
        try {
          const state = await getMonitorState();

          if (!state) {
            return new Response(JSON.stringify({ error: 'No data available' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }

          return Response.json(projectPublicData(config.monitors, state), { headers: corsHeaders });
        } catch (error) {
          console.error('Error in /api/data:', error);
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

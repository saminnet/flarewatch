import { createFileRoute } from '@tanstack/react-router';
import { getMaintenances } from '@/lib/kv';
import { pageConfig } from '@flarewatch/config';

function getCorsHeaders(request: Request): Record<string, string> {
  const allowedOrigins = pageConfig.apiCorsOrigins;
  const origin = request.headers.get('Origin');

  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (!allowedOrigins || allowedOrigins.length === 0) {
    return { ...base, 'Access-Control-Allow-Origin': '*' };
  }

  if (origin && allowedOrigins.includes(origin)) {
    return { ...base, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  }

  return base;
}

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

import { createFileRoute } from '@tanstack/react-router';
import { getMonitorState } from '@/lib/kv';
import { workerConfig } from '@flarewatch/config/worker';
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

export const Route = createFileRoute('/api/data')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const corsHeaders = getCorsHeaders(request);
        try {
          const state = await getMonitorState();

          if (!state) {
            return new Response(JSON.stringify({ error: 'No data available' }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }

          const monitors: Record<
            string,
            {
              up: boolean;
              latency: number | null;
              location: string | null;
              message: string;
            }
          > = {};

          for (const monitor of workerConfig.monitors) {
            const incidents = state.incident[monitor.id];
            const latencyData = state.latency[monitor.id]?.recent;

            const lastIncident = incidents?.[incidents.length - 1];
            const isUp =
              !incidents ||
              incidents.length === 0 ||
              !lastIncident ||
              lastIncident.end !== undefined;

            const latestLatency = latencyData?.[latencyData.length - 1];
            const latestError = incidents?.[incidents.length - 1]?.error;

            monitors[monitor.id] = {
              up: isUp,
              latency: latestLatency?.ping ?? null,
              location: latestLatency?.loc ?? null,
              message: isUp ? 'OK' : (latestError?.[latestError.length - 1] ?? 'Unknown error'),
            };
          }

          const response = {
            up: state.overallUp,
            down: state.overallDown,
            updatedAt: state.lastUpdate,
            monitors,
          };

          return Response.json(response, { headers: corsHeaders });
        } catch (error) {
          console.error('Error in /api/data:', error);
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

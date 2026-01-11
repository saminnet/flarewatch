import { createFileRoute } from '@tanstack/react-router';
import { getMonitorState } from '@/lib/kv';
import { isMonitorUp, getMonitorError } from '@/lib/uptime';
import { getCorsHeaders } from '@/lib/cors';
import { getConfig } from '@/lib/config';

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

          const monitors: Record<
            string,
            {
              up: boolean;
              latency: number | null;
              location: string | null;
              message: string;
            }
          > = {};

          for (const monitor of config.monitors) {
            const latencyData = state.latency[monitor.id]?.recent;
            const latestLatency = latencyData?.[latencyData.length - 1];
            const isUp = isMonitorUp(monitor.id, state);
            const error = getMonitorError(monitor.id, state);

            monitors[monitor.id] = {
              up: isUp,
              latency: latestLatency?.ping ?? null,
              location: latestLatency?.loc ?? null,
              message: isUp ? 'OK' : (error ?? 'Unknown error'),
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

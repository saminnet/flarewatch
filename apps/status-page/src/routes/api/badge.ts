import { createFileRoute } from '@tanstack/react-router';
import { getMonitorState } from '@/lib/kv';
import { isMonitorUp } from '@/lib/uptime';
import { getConfig } from '@/lib/config';

type BadgePayload = {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
  isError?: boolean;
};

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, max-age=0, must-revalidate',
};

function errorBadge(label: string, message: string): BadgePayload {
  return {
    schemaVersion: 1,
    label,
    message,
    color: 'lightgrey',
    isError: true,
  };
}

export const Route = createFileRoute('/api/badge')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        try {
          const url = new URL(request.url);
          const config = await getConfig();

          const defaultMonitorId = config.monitors[0]?.id;
          const monitorId = url.searchParams.get('id') ?? defaultMonitorId;
          const label = url.searchParams.get('label') ?? monitorId ?? 'FlareWatch';

          const upMsg = url.searchParams.get('up') ?? 'UP';
          const downMsg = url.searchParams.get('down') ?? 'DOWN';
          const colorUp = url.searchParams.get('colorUp') ?? 'brightgreen';
          const colorDown = url.searchParams.get('colorDown') ?? 'red';

          if (!monitorId) {
            return new Response(JSON.stringify(errorBadge(label, 'no-monitor')), {
              status: 400,
              headers: jsonHeaders,
            });
          }

          const state = await getMonitorState();

          if (!state) {
            return new Response(JSON.stringify(errorBadge(label, 'unavailable')), {
              status: 503,
              headers: jsonHeaders,
            });
          }

          const hasIncidentHistory = Boolean(state.incident?.[monitorId]);
          const hasLatencyData = Boolean(state.latency?.[monitorId]?.recent?.length);

          if (!hasIncidentHistory || !hasLatencyData) {
            return new Response(JSON.stringify(errorBadge(label, 'unknown')), {
              status: 404,
              headers: jsonHeaders,
            });
          }

          const isUp = isMonitorUp(monitorId, state);

          const badge: BadgePayload = {
            schemaVersion: 1,
            label,
            message: isUp ? upMsg : downMsg,
            color: isUp ? colorUp : colorDown,
          };

          return new Response(JSON.stringify(badge), { headers: jsonHeaders });
        } catch (error) {
          console.error('Error rendering badge API:', error);
          return new Response(JSON.stringify(errorBadge('status', 'error')), {
            status: 500,
            headers: jsonHeaders,
          });
        }
      },
    },
  },
});

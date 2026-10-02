import { createFileRoute } from '@tanstack/react-router';
import { readVisitorSnapshot } from '@/lib/snapshots';
import { projectBadgeStatus } from '@/lib/status-projection';

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
          const { monitors, state, maintenances } = await readVisitorSnapshot();

          const defaultMonitorId = monitors[0]?.id;
          const monitorId = url.searchParams.get('id') ?? defaultMonitorId;
          const label = url.searchParams.get('label') ?? monitorId ?? 'FlareWatch';

          const upMsg = url.searchParams.get('up') ?? 'UP';
          const downMsg = url.searchParams.get('down') ?? 'DOWN';
          const colorUp = url.searchParams.get('colorUp') ?? 'brightgreen';
          const colorDown = url.searchParams.get('colorDown') ?? 'red';
          const degradedMsg = url.searchParams.get('degraded') ?? 'DEGRADED';
          const colorDegraded = url.searchParams.get('colorDegraded') ?? 'yellow';

          if (!monitorId) {
            return new Response(JSON.stringify(errorBadge(label, 'no-monitor')), {
              status: 400,
              headers: jsonHeaders,
            });
          }

          const monitor = monitors.find((candidate) => candidate.id === monitorId);
          if (!monitor) {
            return new Response(JSON.stringify(errorBadge(label, 'unknown')), {
              status: 404,
              headers: jsonHeaders,
            });
          }

          if (!state) {
            return new Response(JSON.stringify(errorBadge(label, 'unavailable')), {
              status: 503,
              headers: jsonHeaders,
            });
          }

          const projected = projectBadgeStatus(monitor, state, maintenances);
          if (projected.status === 'unknown') {
            return new Response(JSON.stringify(errorBadge(label, 'unknown')), {
              status: 404,
              headers: jsonHeaders,
            });
          }

          const looks: Record<typeof projected.status, [message: string, color: string]> = {
            up: [upMsg, colorUp],
            degraded: [degradedMsg, colorDegraded],
            down: [downMsg, colorDown],
          };
          const [message, color] = looks[projected.status];
          const badge: BadgePayload = { schemaVersion: 1, label, message, color };

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

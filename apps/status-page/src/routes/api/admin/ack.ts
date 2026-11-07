import { createFileRoute } from '@tanstack/react-router';
import { isJsonObject, isNonEmptyString } from '@flarewatch/shared';
import { ackIncident } from '@/lib/monitor-worker';
import { jsonError, readBody } from '@/lib/admin-http';
import { operatorName } from '@/lib/operator.server';
import { forgetCachedView } from '@/lib/snapshots';

export const Route = createFileRoute('/api/admin/ack')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const body = await readBody(request);
          if (!isJsonObject(body) || !isNonEmptyString(body.id))
            return jsonError('id is required', 400);
          if (!(await ackIncident(body.id, await operatorName(request))))
            return jsonError('No unacknowledged open incident', 409);
          forgetCachedView();
          return new Response(null, { status: 204 });
        } catch (error) {
          console.error('Error acknowledging incident:', error);
          return jsonError('Internal server error', 500);
        }
      },
    },
  },
});

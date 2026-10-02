import { createFileRoute } from '@tanstack/react-router';
import { isJsonObject, isNonEmptyString, readJsonUpTo } from '@flarewatch/shared';
import { checkMonitorNow } from '@/lib/monitor-worker';

const MAX_BODY_BYTES = 1024;

/** The id, or null unless the body is exactly `{ id }`: the target and proxy come from the config. */
async function readId(request: Request): Promise<string | null> {
  const body = await readJsonUpTo(request, MAX_BODY_BYTES).catch(() => null);
  if (!isJsonObject(body) || Object.keys(body).length !== 1 || !isNonEmptyString(body.id)) {
    return null;
  }
  return body.id;
}

export const Route = createFileRoute('/api/admin/check')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const id = await readId(request);
          if (id === null) {
            return Response.json({ error: 'Send only { "id": "<monitor id>" }' }, { status: 400 });
          }
          const answer = await checkMonitorNow(id);
          return 'check' in answer
            ? Response.json(answer.check)
            : Response.json({ error: answer.error }, { status: answer.status });
        } catch (error) {
          console.error('Error running check now:', error);
          return Response.json({ error: 'Internal server error' }, { status: 500 });
        }
      },
    },
  },
});

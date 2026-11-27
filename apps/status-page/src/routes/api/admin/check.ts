import { createFileRoute } from '@tanstack/react-router';
import { isJsonObject, isNonEmptyString, readJsonUpTo } from '@flarewatch/shared';
import { checkMonitorNow } from '@/lib/monitor-worker';

const MAX_BODY_BYTES = 1024;

/** The id and optional via index, or null unless only those keys are sent: target and proxy come from config. */
async function readRequest(request: Request): Promise<{ id: string; via?: number } | null> {
  const body = await readJsonUpTo(request, MAX_BODY_BYTES).catch(() => null);
  if (!isJsonObject(body) || !isNonEmptyString(body.id)) return null;
  if (Object.keys(body).some((key) => key !== 'id' && key !== 'via')) return null;
  if (body.via === undefined) return { id: body.id };
  if (typeof body.via !== 'number' || !Number.isSafeInteger(body.via) || body.via < 0) return null;
  return { id: body.id, via: body.via };
}

export const Route = createFileRoute('/api/admin/check')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const parsed = await readRequest(request);
          if (parsed === null) {
            return Response.json(
              { error: 'Send { "id": "<monitor id>" } and an optional non-negative integer "via"' },
              { status: 400 },
            );
          }
          const answer = await checkMonitorNow(parsed.id, parsed.via);
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

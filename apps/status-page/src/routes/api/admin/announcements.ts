import { createFileRoute } from '@tanstack/react-router';
import {
  isJsonObject,
  isNonEmptyString,
  normalizeAnnouncement,
  readJsonUpTo,
  type Announcement,
  type JsonObject,
  type NormalizedAnnouncement,
} from '@flarewatch/shared';
import {
  AnnouncementRefused,
  deleteAnnouncement,
  fetchAnnouncements,
  saveAnnouncement,
} from '@/lib/monitor-worker';
import { forgetCachedView } from '@/lib/snapshots';

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const MAX_BODY_BYTES = 64 * 1024;

function readBody(request: Request): Promise<unknown> {
  return readJsonUpTo(request, MAX_BODY_BYTES).catch(() => null);
}

function generateAnnouncementId(): string {
  return `ann_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

const FIELDS = ['title', 'body', 'end'] as const;

function withInput(base: Partial<Announcement>, input: JsonObject) {
  const set = FIELDS.filter((field) => input[field] !== undefined);
  return { ...base, ...Object.fromEntries(set.map((field) => [field, input[field] ?? undefined])) };
}

function normalizeAnnouncementUpdates(
  input: unknown,
  current: Announcement,
): { updates: NormalizedAnnouncement } | { error: string } {
  if (!isJsonObject(input)) return { error: 'An announcement must be an object' };
  const result = normalizeAnnouncement(withInput(current, input));
  if ('error' in result) return result;

  return { updates: result.value };
}

function parseAnnouncementPayload(body: unknown): { id: string; updates: unknown } | null {
  if (!isJsonObject(body) || !isNonEmptyString(body.id)) return null;
  return { id: body.id, updates: body.updates };
}

export const Route = createFileRoute('/api/admin/announcements')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const announcements = await fetchAnnouncements();
          return Response.json(announcements);
        } catch (error) {
          console.error('Error listing announcements:', error);
          return jsonError('Internal server error', 500);
        }
      },

      POST: async ({ request }: { request: Request }) => {
        try {
          const body = await readBody(request);
          const result = normalizeAnnouncement(isJsonObject(body) ? withInput({}, body) : body);

          if ('error' in result) {
            return jsonError(`Invalid announcement payload: ${result.error}`, 400);
          }

          const now = Date.now();
          const announcement: Announcement = {
            ...result.value,
            id: generateAnnouncementId(),
            createdAt: now,
            updatedAt: now,
          };

          await saveAnnouncement(announcement);
          forgetCachedView();

          return Response.json(announcement, { status: 201 });
        } catch (error) {
          if (error instanceof AnnouncementRefused) return jsonError(error.message, 400);
          console.error('Error creating announcement:', error);
          return jsonError('Internal server error', 500);
        }
      },

      PUT: async ({ request }: { request: Request }) => {
        try {
          const payload = parseAnnouncementPayload(await readBody(request));

          if (!payload) {
            return jsonError('id is required', 400);
          }

          const announcements = await fetchAnnouncements();
          const current = announcements.find((a) => a.id === payload.id);

          if (!current) {
            return jsonError('Announcement not found', 404);
          }

          const result = normalizeAnnouncementUpdates(payload.updates, current);
          if ('error' in result) {
            return jsonError(`Invalid announcement updates: ${result.error}`, 400);
          }

          const updated: Announcement = {
            ...result.updates,
            id: current.id,
            createdAt: current.createdAt,
            updatedAt: Date.now(),
          };

          await saveAnnouncement(updated);
          forgetCachedView();

          return Response.json(updated);
        } catch (error) {
          if (error instanceof AnnouncementRefused) return jsonError(error.message, 400);
          console.error('Error updating announcement:', error);
          return jsonError('Internal server error', 500);
        }
      },

      DELETE: async ({ request }: { request: Request }) => {
        try {
          const payload = parseAnnouncementPayload(await readBody(request));

          if (!payload) {
            return jsonError('id is required', 400);
          }

          if (!(await deleteAnnouncement(payload.id))) {
            return jsonError('Announcement not found', 404);
          }
          forgetCachedView();
          return new Response(null, { status: 204 });
        } catch (error) {
          console.error('Error deleting announcement:', error);
          return jsonError('Internal server error', 500);
        }
      },
    },
  },
});

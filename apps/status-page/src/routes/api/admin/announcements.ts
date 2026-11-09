import { createFileRoute } from '@tanstack/react-router';
import {
  isIncidentStatus,
  isJsonObject,
  isNonEmptyString,
  normalizeAnnouncement,
  type Announcement,
  type IncidentStatus,
  type JsonObject,
} from '@flarewatch/shared';
import {
  AnnouncementRefused,
  appendAnnouncementUpdate,
  deleteAnnouncement,
  fetchAnnouncements,
  saveAnnouncement,
} from '@/lib/monitor-worker';
import { getConfig } from '@/lib/config';
import { forgetCachedView } from '@/lib/hub-cache';
import { operatorName } from '@/lib/operator.server';
import { jsonError, readBody } from '@/lib/admin-http';

function generateAnnouncementId(): string {
  return `ann_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

const FIELDS = ['title', 'body', 'end', 'kind', 'monitors', 'status'] as const;

function withInput(base: Partial<Announcement>, input: JsonObject) {
  const set = FIELDS.filter((field) => input[field] !== undefined);
  return { ...base, ...Object.fromEntries(set.map((field) => [field, input[field] ?? undefined])) };
}

function validateAnnouncement(input: unknown, retained: string[] = []) {
  const result = normalizeAnnouncement(input);
  if ('error' in result) return result;
  const ids = new Set([...getConfig().monitors.map((monitor) => monitor.id), ...retained]);
  if (result.value.monitors?.some((id) => !ids.has(id))) return { error: 'Unknown monitor' };
  return result;
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
          const result = validateAnnouncement(isJsonObject(body) ? withInput({}, body) : body);

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
          await forgetCachedView();

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

          if (!isJsonObject(payload.updates)) return jsonError('Invalid announcement updates', 400);
          const updates = payload.updates;
          const { addUpdate } = updates;
          let update: { status: IncidentStatus; body: string; by: string } | undefined;
          if (addUpdate !== undefined) {
            if (
              !isJsonObject(addUpdate) ||
              !isIncidentStatus(addUpdate.status) ||
              typeof addUpdate.body !== 'string'
            )
              return jsonError('Invalid update', 400);
            update = {
              status: addUpdate.status,
              body: addUpdate.body,
              by: await operatorName(request),
            };
          }

          if (update && !FIELDS.some((field) => updates[field] !== undefined)) {
            const updated = await appendAnnouncementUpdate(payload.id, update);
            await forgetCachedView();
            return Response.json(updated);
          }

          const announcements = await fetchAnnouncements();
          const current = announcements.find((a) => a.id === payload.id);

          if (!current) {
            return jsonError('Announcement not found', 404);
          }

          const result = validateAnnouncement(
            withInput(
              current,
              update ? { ...updates, status: current.status ?? 'investigating' } : updates,
            ),
            current.monitors,
          );
          if ('error' in result) {
            return jsonError(`Invalid announcement updates: ${result.error}`, 400);
          }

          const updated: Announcement = {
            ...result.value,
            id: current.id,
            createdAt: current.createdAt,
            updatedAt: Date.now(),
          };

          const saved = update ? await appendAnnouncementUpdate(current.id, update) : undefined;
          if (
            !update ||
            FIELDS.some(
              (field) => JSON.stringify(result.value[field]) !== JSON.stringify(current[field]),
            )
          )
            await saveAnnouncement(updated);
          await forgetCachedView();

          return Response.json(
            saved
              ? {
                  ...updated,
                  updates: saved.updates,
                  status: saved.status,
                  updatedAt: saved.updatedAt,
                }
              : updated,
          );
        } catch (error) {
          if (error instanceof AnnouncementRefused) return jsonError(error.message, error.status);
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
          await forgetCachedView();
          return new Response(null, { status: 204 });
        } catch (error) {
          console.error('Error deleting announcement:', error);
          return jsonError('Internal server error', 500);
        }
      },
    },
  },
});

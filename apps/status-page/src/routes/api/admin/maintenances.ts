import { createFileRoute } from '@tanstack/react-router';
import {
  isJsonObject,
  type Maintenance,
  type MaintenanceConfig,
  isNonEmptyString,
  readJsonUpTo,
} from '@flarewatch/shared';
import { deleteMaintenance, fetchHubView, saveMaintenance } from '@/lib/hub';
import { forgetCachedView } from '@/lib/kv';

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const MAX_BODY_BYTES = 64 * 1024;

/** The JSON body, or null when it is not JSON or is over MAX_BODY_BYTES. */
function readBody(request: Request): Promise<unknown> {
  return readJsonUpTo(request, MAX_BODY_BYTES).catch(() => null);
}

/**
 * Monitor ids, deduplicated; undefined for every monitor. Null when an entry is no id:
 * dropping it could empty the list, which would widen the window to every monitor.
 */
function parseMonitors(value: unknown[]): string[] | undefined | null {
  if (!value.every(isNonEmptyString)) return null;
  return value.length > 0 ? Array.from(new Set(value)) : undefined;
}

function generateMaintenanceId(): string {
  return `maint_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

function parseDateMs(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function normalizeMaintenanceInput(input: unknown): MaintenanceConfig | null {
  if (!isJsonObject(input)) return null;

  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!body) return null;

  const startMs = parseDateMs(input.start);
  if (startMs === null) return null;

  const endMs = input.end !== undefined ? parseDateMs(input.end) : undefined;
  if (endMs === null) return null;
  if (endMs !== undefined && endMs < startMs) return null;

  const title =
    typeof input.title === 'string' && input.title.trim() ? input.title.trim() : undefined;
  const color =
    typeof input.color === 'string' && input.color.trim() ? input.color.trim() : undefined;

  const monitors = Array.isArray(input.monitors) ? parseMonitors(input.monitors) : undefined;
  if (monitors === null) return null;

  return {
    title,
    body,
    start: new Date(startMs).toISOString(),
    end: endMs !== undefined ? new Date(endMs).toISOString() : undefined,
    monitors,
    color,
  };
}

function parseNullableString(
  value: unknown,
): { valid: true; value: string | undefined } | { valid: false } {
  if (value === null) return { valid: true, value: undefined };
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return { valid: true, value: trimmed || undefined };
  }
  return { valid: false };
}

export function normalizeMaintenanceUpdates(
  input: unknown,
  current: Maintenance,
): Partial<MaintenanceConfig> | null {
  if (!isJsonObject(input)) return null;

  const updates: Partial<MaintenanceConfig> = {};

  if (input.title !== undefined) {
    const result = parseNullableString(input.title);
    if (!result.valid) return null;
    updates.title = result.value;
  }

  if (input.body !== undefined) {
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    if (!body) return null;
    updates.body = body;
  }

  if (input.color !== undefined) {
    const result = parseNullableString(input.color);
    if (!result.valid) return null;
    updates.color = result.value;
  }

  if (input.monitors !== undefined) {
    if (input.monitors === null) {
      updates.monitors = undefined;
    } else if (Array.isArray(input.monitors)) {
      const monitors = parseMonitors(input.monitors);
      if (monitors === null) return null;
      updates.monitors = monitors;
    } else {
      return null;
    }
  }

  const currentStartMs = parseDateMs(current.start);
  if (currentStartMs === null) return null;

  const currentEndMs = current.end === undefined ? undefined : parseDateMs(current.end);
  if (currentEndMs === null) return null;

  let nextStartMs = currentStartMs;
  if (input.start !== undefined) {
    const parsed = parseDateMs(input.start);
    if (parsed === null) return null;
    nextStartMs = parsed;
    updates.start = new Date(parsed).toISOString();
  }

  let nextEndMs = currentEndMs;
  if (input.end !== undefined) {
    if (input.end === null) {
      nextEndMs = undefined;
      updates.end = undefined;
    } else {
      const parsed = parseDateMs(input.end);
      if (parsed === null) return null;
      nextEndMs = parsed;
      updates.end = new Date(parsed).toISOString();
    }
  }

  if (nextEndMs !== undefined && nextEndMs < nextStartMs) return null;

  return updates;
}

function parseMaintenancePayload(body: unknown): { id: string; updates: unknown } | null {
  if (!isJsonObject(body) || !isNonEmptyString(body.id)) return null;
  return { id: body.id, updates: body.updates };
}

export const Route = createFileRoute('/api/admin/maintenances')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { maintenances } = await fetchHubView();
          return Response.json(maintenances);
        } catch (error) {
          console.error('Error listing maintenances:', error);
          return jsonError('Internal server error', 500);
        }
      },

      POST: async ({ request }: { request: Request }) => {
        try {
          const input = normalizeMaintenanceInput(await readBody(request));

          if (!input) {
            return jsonError('Invalid maintenance payload', 400);
          }

          const now = Date.now();
          const maintenance: Maintenance = {
            ...input,
            id: generateMaintenanceId(),
            createdAt: now,
            updatedAt: now,
          };

          await saveMaintenance(maintenance);
          forgetCachedView();

          return Response.json(maintenance, { status: 201 });
        } catch (error) {
          console.error('Error creating maintenance:', error);
          return jsonError('Internal server error', 500);
        }
      },

      PUT: async ({ request }: { request: Request }) => {
        try {
          const payload = parseMaintenancePayload(await readBody(request));

          if (!payload) {
            return jsonError('id is required', 400);
          }

          const { maintenances } = await fetchHubView();
          const current = maintenances.find((m) => m.id === payload.id);

          if (!current) {
            return jsonError('Maintenance not found', 404);
          }

          const updates = normalizeMaintenanceUpdates(payload.updates, current);
          if (!updates) {
            return jsonError('Invalid maintenance updates', 400);
          }

          const updated: Maintenance = {
            ...current,
            ...updates,
            id: current.id,
            createdAt: current.createdAt,
            updatedAt: Date.now(),
          };

          await saveMaintenance(updated);
          forgetCachedView();

          return Response.json(updated);
        } catch (error) {
          console.error('Error updating maintenance:', error);
          return jsonError('Internal server error', 500);
        }
      },

      DELETE: async ({ request }: { request: Request }) => {
        try {
          const payload = parseMaintenancePayload(await readBody(request));

          if (!payload) {
            return jsonError('id is required', 400);
          }

          if (!(await deleteMaintenance(payload.id))) {
            return jsonError('Maintenance not found', 404);
          }
          forgetCachedView();
          return new Response(null, { status: 204 });
        } catch (error) {
          console.error('Error deleting maintenance:', error);
          return jsonError('Internal server error', 500);
        }
      },
    },
  },
});

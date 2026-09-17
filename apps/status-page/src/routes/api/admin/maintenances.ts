import { createFileRoute } from '@tanstack/react-router';
import type { Maintenance, MaintenanceConfig } from '@flarewatch/shared';
import { writeMaintenancesToStorage, readMaintenancesFromStorage } from '@flarewatch/shared';
import { requireStateKv } from '@/lib/runtime-env';

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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
  if (!input || typeof input !== 'object') return null;

  const body = 'body' in input && typeof input.body === 'string' ? input.body.trim() : '';
  if (!body) return null;

  const startMs = 'start' in input ? parseDateMs(input.start) : null;
  if (startMs === null) return null;

  const endMs = 'end' in input && input.end !== undefined ? parseDateMs(input.end) : undefined;
  if (endMs === null) return null;
  if (endMs !== undefined && endMs < startMs) return null;

  const title =
    'title' in input && typeof input.title === 'string' && input.title.trim()
      ? input.title.trim()
      : undefined;
  const color =
    'color' in input && typeof input.color === 'string' && input.color.trim()
      ? input.color.trim()
      : undefined;

  const monitors =
    'monitors' in input && Array.isArray(input.monitors)
      ? input.monitors.filter((m): m is string => typeof m === 'string' && m.length > 0)
      : undefined;

  return {
    title,
    body,
    start: new Date(startMs).toISOString(),
    end: endMs !== undefined ? new Date(endMs).toISOString() : undefined,
    monitors: monitors && monitors.length > 0 ? Array.from(new Set(monitors)) : undefined,
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

function normalizeMaintenanceUpdates(
  input: unknown,
  current: Maintenance,
): Partial<MaintenanceConfig> | null {
  if (!input || typeof input !== 'object') return null;

  const updates: Partial<MaintenanceConfig> = {};

  if ('title' in input && input.title !== undefined) {
    const result = parseNullableString(input.title);
    if (!result.valid) return null;
    updates.title = result.value;
  }

  if ('body' in input && input.body !== undefined) {
    const body = typeof input.body === 'string' ? input.body.trim() : '';
    if (!body) return null;
    updates.body = body;
  }

  if ('color' in input && input.color !== undefined) {
    const result = parseNullableString(input.color);
    if (!result.valid) return null;
    updates.color = result.value;
  }

  if ('monitors' in input && input.monitors !== undefined) {
    if (input.monitors === null) {
      updates.monitors = undefined;
    } else if (Array.isArray(input.monitors)) {
      const monitors = input.monitors.filter(
        (m): m is string => typeof m === 'string' && m.length > 0,
      );
      updates.monitors = monitors.length ? Array.from(new Set(monitors)) : undefined;
    } else {
      return null;
    }
  }

  const currentStartMs = parseDateMs(current.start);
  if (currentStartMs === null) return null;

  const currentEndMs = current.end === undefined ? undefined : parseDateMs(current.end);
  if (currentEndMs === null) return null;

  let nextStartMs = currentStartMs;
  if ('start' in input && input.start !== undefined) {
    const parsed = parseDateMs(input.start);
    if (parsed === null) return null;
    nextStartMs = parsed;
    updates.start = new Date(parsed).toISOString();
  }

  let nextEndMs = currentEndMs;
  if ('end' in input && input.end !== undefined) {
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
  if (typeof body !== 'object' || body === null || !('id' in body)) return null;
  if (typeof body.id !== 'string' || !body.id) return null;
  return { id: body.id, updates: 'updates' in body ? body.updates : undefined };
}

export const Route = createFileRoute('/api/admin/maintenances')({
  server: {
    handlers: {
      // List all maintenances
      GET: async () => {
        try {
          const kv = await requireStateKv();
          const maintenances = await readMaintenancesFromStorage(kv);
          return Response.json(maintenances);
        } catch (error) {
          console.error('Error listing maintenances:', error);
          return jsonError('Internal server error', 500);
        }
      },

      // Create a new maintenance
      POST: async ({ request }: { request: Request }) => {
        try {
          const body: unknown = await request.json();
          const input = normalizeMaintenanceInput(body);

          if (!input) {
            return jsonError('Invalid maintenance payload', 400);
          }

          const kv = await requireStateKv();
          const now = Date.now();
          const maintenance: Maintenance = {
            ...input,
            id: generateMaintenanceId(),
            createdAt: now,
            updatedAt: now,
          };

          const maintenances = await readMaintenancesFromStorage(kv);
          await writeMaintenancesToStorage(kv, [...maintenances, maintenance]);

          return Response.json(maintenance, { status: 201 });
        } catch (error) {
          console.error('Error creating maintenance:', error);
          return jsonError('Internal server error', 500);
        }
      },

      // Update an existing maintenance
      PUT: async ({ request }: { request: Request }) => {
        try {
          const payload = parseMaintenancePayload(await request.json());

          if (!payload) {
            return jsonError('id is required', 400);
          }

          const kv = await requireStateKv();
          const maintenances = await readMaintenancesFromStorage(kv);
          const index = maintenances.findIndex((m) => m.id === payload.id);
          const current = maintenances[index];

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

          const nextMaintenances = [...maintenances];
          nextMaintenances[index] = updated;
          await writeMaintenancesToStorage(kv, nextMaintenances);

          return Response.json(updated);
        } catch (error) {
          console.error('Error updating maintenance:', error);
          return jsonError('Internal server error', 500);
        }
      },

      // Delete a maintenance
      DELETE: async ({ request }: { request: Request }) => {
        try {
          const payload = parseMaintenancePayload(await request.json());

          if (!payload) {
            return jsonError('id is required', 400);
          }

          const kv = await requireStateKv();
          const maintenances = await readMaintenancesFromStorage(kv);
          const filtered = maintenances.filter((m) => m.id !== payload.id);

          if (filtered.length === maintenances.length) {
            return jsonError('Maintenance not found', 404);
          }

          await writeMaintenancesToStorage(kv, filtered);
          return new Response(null, { status: 204 });
        } catch (error) {
          console.error('Error deleting maintenance:', error);
          return jsonError('Internal server error', 500);
        }
      },
    },
  },
});

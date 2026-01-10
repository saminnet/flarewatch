import { createFileRoute } from '@tanstack/react-router';
import type { Maintenance, MaintenanceConfig } from '@flarewatch/shared';
import { requireKv } from '@/lib/runtime-env';

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function readMaintenances(kv: KVNamespace): Promise<Maintenance[]> {
  const data = await kv.get('maintenances', { type: 'json' });
  return (data as Maintenance[] | null) ?? [];
}

function generateMaintenanceId(): string {
  return `maint_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseDateMs(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function normalizeMaintenanceInput(input: unknown): MaintenanceConfig | null {
  if (!input || typeof input !== 'object') return null;
  const data = input as Record<string, unknown>;

  const body = typeof data.body === 'string' ? data.body.trim() : '';
  if (!body) return null;

  const startMs = parseDateMs(data.start);
  if (startMs === null) return null;

  const endMs = data.end === undefined ? undefined : parseDateMs(data.end);
  if (endMs === null) return null;
  if (endMs !== undefined && endMs < startMs) return null;

  const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : undefined;
  const color = typeof data.color === 'string' && data.color.trim() ? data.color.trim() : undefined;

  const monitors = Array.isArray(data.monitors)
    ? (data.monitors.filter((m): m is string => typeof m === 'string' && m.length > 0) as string[])
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

function normalizeMaintenanceUpdates(
  input: unknown,
  current: Maintenance,
): Partial<MaintenanceConfig> | null {
  if (!input || typeof input !== 'object') return null;
  const data = input as Record<string, unknown>;

  const updates: Partial<MaintenanceConfig> = {};

  if (data.title !== undefined) {
    if (data.title === null) {
      updates.title = undefined;
    } else if (typeof data.title === 'string') {
      updates.title = data.title.trim() ? data.title.trim() : undefined;
    } else {
      return null;
    }
  }

  if (data.body !== undefined) {
    const body = typeof data.body === 'string' ? data.body.trim() : '';
    if (!body) return null;
    updates.body = body;
  }

  if (data.color !== undefined) {
    if (data.color === null) {
      updates.color = undefined;
    } else if (typeof data.color === 'string') {
      updates.color = data.color.trim() ? data.color.trim() : undefined;
    } else {
      return null;
    }
  }

  if (data.monitors !== undefined) {
    if (data.monitors === null) {
      updates.monitors = undefined;
    } else if (Array.isArray(data.monitors)) {
      const monitors = data.monitors.filter(
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
  if (data.start !== undefined) {
    const parsed = parseDateMs(data.start);
    if (parsed === null) return null;
    nextStartMs = parsed;
    updates.start = new Date(parsed).toISOString();
  }

  let nextEndMs = currentEndMs;
  if (data.end !== undefined) {
    if (data.end === null) {
      nextEndMs = undefined;
      updates.end = undefined;
    } else {
      const parsed = parseDateMs(data.end);
      if (parsed === null) return null;
      nextEndMs = parsed;
      updates.end = new Date(parsed).toISOString();
    }
  }

  if (nextEndMs !== undefined && nextEndMs < nextStartMs) return null;

  return updates;
}

export const Route = createFileRoute('/api/admin/maintenances')({
  server: {
    handlers: {
      // List all maintenances
      GET: async () => {
        try {
          const kv = await requireKv();
          const maintenances = await readMaintenances(kv);
          return Response.json(maintenances);
        } catch (error) {
          console.error('Error listing maintenances:', error);
          return jsonError('Internal server error', 500);
        }
      },

      // Create a new maintenance
      POST: async ({ request }: { request: Request }) => {
        try {
          const body = (await request.json()) as unknown;
          const input = normalizeMaintenanceInput(body);

          if (!input) {
            return jsonError('Invalid maintenance payload', 400);
          }

          const kv = await requireKv();
          const now = Date.now();
          const maintenance: Maintenance = {
            ...input,
            id: generateMaintenanceId(),
            createdAt: now,
            updatedAt: now,
          };

          const maintenances = await readMaintenances(kv);
          maintenances.push(maintenance);
          await kv.put('maintenances', JSON.stringify(maintenances));

          return Response.json(maintenance, { status: 201 });
        } catch (error) {
          console.error('Error creating maintenance:', error);
          return jsonError('Internal server error', 500);
        }
      },

      // Update an existing maintenance
      PUT: async ({ request }: { request: Request }) => {
        try {
          const body = (await request.json()) as { id: string; updates: unknown };

          if (!body.id) {
            return jsonError('id is required', 400);
          }

          const kv = await requireKv();
          const maintenances = await readMaintenances(kv);
          const index = maintenances.findIndex((m) => m.id === body.id);
          const current = maintenances[index];

          if (!current) {
            return jsonError('Maintenance not found', 404);
          }

          const updates = normalizeMaintenanceUpdates(body.updates, current);
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

          maintenances[index] = updated;
          await kv.put('maintenances', JSON.stringify(maintenances));

          return Response.json(updated);
        } catch (error) {
          console.error('Error updating maintenance:', error);
          return jsonError('Internal server error', 500);
        }
      },

      // Delete a maintenance
      DELETE: async ({ request }: { request: Request }) => {
        try {
          const body = (await request.json()) as { id: string };

          if (!body.id) {
            return jsonError('id is required', 400);
          }

          const kv = await requireKv();
          const maintenances = await readMaintenances(kv);
          const filtered = maintenances.filter((m) => m.id !== body.id);

          if (filtered.length === maintenances.length) {
            return jsonError('Maintenance not found', 404);
          }

          await kv.put('maintenances', JSON.stringify(filtered));
          return new Response(null, { status: 204 });
        } catch (error) {
          console.error('Error deleting maintenance:', error);
          return jsonError('Internal server error', 500);
        }
      },
    },
  },
});

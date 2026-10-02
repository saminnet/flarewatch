import { createFileRoute } from '@tanstack/react-router';
import {
  isJsonObject,
  type JsonObject,
  type Maintenance,
  type MaintenanceConfig,
  isNonEmptyString,
  normalizeMaintenance,
  readJsonUpTo,
} from '@flarewatch/shared';
import {
  deleteMaintenance,
  fetchMaintenances,
  MaintenanceRefused,
  saveMaintenance,
} from '@/lib/monitor-worker';
import { forgetCachedView } from '@/lib/snapshots';

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

function generateMaintenanceId(): string {
  return `maint_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

const FIELDS = ['title', 'body', 'start', 'end', 'monitors', 'color', 'repeat'] as const;

type Field = (typeof FIELDS)[number];

/** The fields the input sets, over `base`. Null clears a field. */
function withInput(base: Partial<MaintenanceConfig>, input: JsonObject) {
  const set = FIELDS.filter((field) => input[field] !== undefined);
  return { ...base, ...Object.fromEntries(set.map((field) => [field, input[field] ?? undefined])) };
}

function copyField<K extends Field>(
  to: Partial<MaintenanceConfig>,
  from: MaintenanceConfig,
  field: K,
): void {
  to[field] = from[field];
}

/** The fields to change, checked as the whole window they make with `current`. */
export function normalizeMaintenanceUpdates(
  input: unknown,
  current: Maintenance,
): Partial<MaintenanceConfig> | null {
  if (!isJsonObject(input)) return null;
  const result = normalizeMaintenance(withInput(current, input));
  if ('error' in result) return null;

  const updates: Partial<MaintenanceConfig> = {};
  for (const field of FIELDS) {
    if (input[field] !== undefined) copyField(updates, result.value, field);
  }
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
          const maintenances = await fetchMaintenances();
          return Response.json(maintenances);
        } catch (error) {
          console.error('Error listing maintenances:', error);
          return jsonError('Internal server error', 500);
        }
      },

      POST: async ({ request }: { request: Request }) => {
        try {
          const body = await readBody(request);
          const result = normalizeMaintenance(isJsonObject(body) ? withInput({}, body) : body);

          if ('error' in result) {
            return jsonError(`Invalid maintenance payload: ${result.error}`, 400);
          }

          const now = Date.now();
          const maintenance: Maintenance = {
            ...result.value,
            id: generateMaintenanceId(),
            createdAt: now,
            updatedAt: now,
          };

          await saveMaintenance(maintenance);
          forgetCachedView();

          return Response.json(maintenance, { status: 201 });
        } catch (error) {
          if (error instanceof MaintenanceRefused) return jsonError(error.message, 400);
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

          const maintenances = await fetchMaintenances();
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
          if (error instanceof MaintenanceRefused) return jsonError(error.message, 400);
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

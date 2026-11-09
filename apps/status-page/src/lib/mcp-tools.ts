import { isAnnouncementActive, type StatusView } from '@flarewatch/shared';
import type { Snapshot } from '@/lib/public-view';
import { projectPublicData } from '@/lib/status-projection';
import { countStatuses, getOverallStatus } from '@/lib/monitor-state';
import { calculateUptimePercent, formatUptimeDisplay } from '@/lib/uptime';

export const MAX_INCIDENTS = 50;

export const mcpTools = [
  {
    name: 'get_status',
    description:
      'Read overall page status, monitor counts, last update, active announcements and maintenance windows.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_monitors',
    description:
      'List published monitors with IDs, groups, current status, displayed uptime and open incidents.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_monitor',
    description:
      'Read one published monitor and its newest 10 incidents. Use an ID from list_monitors.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1 } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_incidents',
    description: `Read recent published incidents, newest first. Optionally filter by monitor ID. Default limit: ${MAX_INCIDENTS}.`,
    inputSchema: {
      type: 'object',
      properties: {
        monitorId: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: MAX_INCIDENTS, default: MAX_INCIDENTS },
      },
      additionalProperties: false,
    },
  },
];

export type ToolArgs = { id?: string; monitorId?: string; limit?: number };

function toolContent(data: unknown, summary: string, isError = false) {
  return { content: [{ type: 'text', text: `${JSON.stringify(data)}\n${summary}` }], isError };
}

const toolError = (data: unknown, summary: string) => toolContent(data, summary, true);

function recentIncidents(monitors: Snapshot['monitors'], state: StatusView, monitorId?: string) {
  return monitors
    .filter((monitor) => monitorId === undefined || monitor.id === monitorId)
    .flatMap((monitor) =>
      (state.monitors[monitor.id]?.incidents ?? [])
        .filter((incident) => incident.start.length > 0)
        .map((incident) => ({
          monitorId: monitor.id,
          start: incident.start[0],
          end: incident.end ?? null,
          error: incident.error,
        })),
    )
    .sort((a, b) => (b.start ?? 0) - (a.start ?? 0));
}

export function callStatusTool(name: string, args: ToolArgs, snapshot: Snapshot) {
  const { monitors, state, groups, maintenances, announcements } = snapshot;
  const id = args.id ?? args.monitorId;
  if (id !== undefined && !monitors.some((monitor) => monitor.id === id)) {
    return toolError({ code: 404, error: 'Monitor not found' }, 'Monitor not found.');
  }
  if (!state) return toolError({ error: 'No data available' }, 'Status data is unavailable.');

  const projection = projectPublicData(monitors, state, maintenances);
  if (name === 'get_status') {
    const counts = countStatuses(monitors, state, maintenances);
    const overall = getOverallStatus(counts);
    const degraded = counts.late + counts.slow + counts.expiry;
    return toolContent(
      {
        status: overall,
        up: counts.up,
        degraded,
        down: counts.down,
        updatedAt: projection.updatedAt,
        announcements: announcements.filter((announcement) =>
          isAnnouncementActive(announcement, state.lastUpdate * 1000),
        ),
        maintenances,
      },
      `${overall}: ${counts.up} up, ${degraded} degraded, ${counts.down} down.`,
    );
  }

  if (name === 'list_incidents') {
    const incidents = recentIncidents(monitors, state, id).slice(0, args.limit ?? MAX_INCIDENTS);
    return toolContent({ incidents }, `${incidents.length} recent incidents.`);
  }

  const groupOf = new Map(
    Object.entries(groups).flatMap(([group, ids]) => ids.map((monitorId) => [monitorId, group])),
  );
  const row = (monitor: Snapshot['monitors'][number]) => {
    const latest = state.monitors[monitor.id]?.incidents.at(-1);
    const open = latest?.end === undefined ? latest : undefined;
    return {
      id: monitor.id,
      name: monitor.name,
      group: groupOf.get(monitor.id) ?? null,
      ...projection.monitors[monitor.id],
      uptime: formatUptimeDisplay(
        calculateUptimePercent(monitor.id, state),
        state.monitors[monitor.id]?.startedAt !== undefined,
        2,
      ),
      openIncident: open
        ? { start: open.start[0], error: open.error.at(-1) ?? 'Unknown error' }
        : null,
    };
  };
  if (name === 'get_monitor') {
    const monitor = monitors.find((candidate) => candidate.id === id);
    const current = monitor && row(monitor);
    return toolContent(
      { ...current, incidents: recentIncidents(monitors, state, id).slice(0, 10) },
      `Monitor status: ${current?.status}.`,
    );
  }
  const rows = monitors.map(row);
  return toolContent({ monitors: rows }, `${rows.length} published monitors.`);
}

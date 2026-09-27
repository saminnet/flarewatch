import {
  isPublicMonitor,
  type Maintenance,
  type Monitor,
  type MonitorView,
  type PageConfigGroup,
  type RuntimeConfig,
  type StatusView,
} from '@flarewatch/shared';
import type { Principal } from './auth/access';

export type PublicMonitor = Pick<Monitor, 'id' | 'name' | 'tooltip' | 'method'> & {
  hideLatencyChart?: boolean;
  link?: string;
  isProxy?: boolean;
  /** Heartbeat monitors only: the cadence and grace window of the job. */
  periodSeconds?: number;
  graceSeconds?: number;
};

export type AdminMonitor = PublicMonitor & { private?: boolean };

/** Everything one audience may see on the status page. */
export type Snapshot = {
  monitors: AdminMonitor[];
  groups: PageConfigGroup;
  state: StatusView | null;
  maintenances: Maintenance[];
};

type PublicView = {
  monitors: PublicMonitor[];
  statusPage: RuntimeConfig['statusPage'];
  state: StatusView | null;
};

function toPublicMonitor(monitor: Monitor): PublicMonitor {
  return {
    id: monitor.id,
    name: monitor.name,
    method: monitor.method,
    tooltip: monitor.tooltip,
    link: deriveMonitorLink(monitor),
    hideLatencyChart: 'hideLatencyChart' in monitor ? monitor.hideLatencyChart : undefined,
    isProxy: 'checkProxy' in monitor && Boolean(monitor.checkProxy),
    ...(monitor.method === 'HEARTBEAT' && {
      periodSeconds: monitor.periodSeconds,
      graceSeconds: monitor.graceSeconds,
    }),
  };
}

function deriveMonitorLink(monitor: Monitor): string | undefined {
  if (monitor.link === false) return undefined;
  if (typeof monitor.link === 'string') return monitor.link;

  if (!('target' in monitor)) return undefined;

  try {
    const url = new URL(monitor.target);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch {}

  return undefined;
}

/** The view limited to these monitors. The raw failure reason of a job is operator only. */
function viewOf(state: StatusView, monitorIds: Set<string>, operator: boolean): StatusView {
  const monitors: Record<string, MonitorView> = {};
  for (const [id, monitor] of Object.entries(state.monitors)) {
    if (!monitorIds.has(id)) continue;
    if (operator || !monitor.heartbeat) {
      monitors[id] = monitor;
      continue;
    }
    const { message: _message, ...heartbeat } = monitor.heartbeat;
    monitors[id] = { ...monitor, heartbeat };
  }
  return { lastUpdate: state.lastUpdate, monitors };
}

// A group left with no visible members is dropped: its name alone can describe a private job.
function groupsOf(config: RuntimeConfig, monitorIds: Set<string>): PageConfigGroup {
  return Object.fromEntries(
    Object.entries(config.statusPage?.group ?? {})
      .map(([name, ids]) => [name, ids.filter((id) => monitorIds.has(id))] as const)
      .filter(([, ids]) => ids.length > 0),
  );
}

export function publicView(config: RuntimeConfig, state: StatusView | null): PublicView {
  const monitors = config.monitors.filter(isPublicMonitor).map(toPublicMonitor);
  const monitorIds = new Set(monitors.map((monitor) => monitor.id));
  const groups = groupsOf(config, monitorIds);
  const statusPage = config.statusPage ? { ...config.statusPage, group: groups } : undefined;

  return {
    monitors,
    statusPage,
    state: state && viewOf(state, monitorIds, false),
  };
}

/**
 * Maintenance records someone may see: ids of monitors hidden from them are
 * stripped, and a scoped record left without any visible monitor is dropped.
 */
function maintenancesFor(maintenances: Maintenance[], visibleIds: Set<string>): Maintenance[] {
  const result: Maintenance[] = [];
  for (const maintenance of maintenances) {
    if (!maintenance.monitors?.length) {
      result.push(maintenance);
      continue;
    }
    const monitors = maintenance.monitors.filter((id) => visibleIds.has(id));
    if (monitors.length > 0) result.push({ ...maintenance, monitors });
  }
  return result;
}

export function publicMaintenances(
  config: RuntimeConfig,
  maintenances: Maintenance[],
): Maintenance[] {
  return maintenancesFor(maintenances, visibleMonitorIds(config, null));
}

/**
 * The monitors someone may see: the published ones for visitors, plus their
 * page groups for an audience member, and all of them for the operator and
 * for members.
 */
export function visibleMonitorIds(config: RuntimeConfig, principal: Principal | null): Set<string> {
  const all = config.monitors.map((monitor) => monitor.id);
  if (principal && (principal.role === 'operator' || principal.groups === 'all')) {
    return new Set(all);
  }
  const ids = new Set(config.monitors.filter(isPublicMonitor).map((monitor) => monitor.id));
  const configured = new Set(all);
  for (const group of principal?.groups ?? []) {
    for (const id of config.statusPage?.group?.[group] ?? []) {
      if (configured.has(id)) ids.add(id);
    }
  }
  return ids;
}

export function toAdminMonitors(config: RuntimeConfig): AdminMonitor[] {
  return config.monitors.map((monitor) => ({
    ...toPublicMonitor(monitor),
    ...(monitor.private && { private: true }),
  }));
}

export function visitorSnapshot(
  config: RuntimeConfig,
  state: StatusView | null,
  maintenances: Maintenance[],
): Snapshot {
  const view = publicView(config, state);
  return {
    monitors: view.monitors,
    groups: view.statusPage?.group ?? {},
    state: view.state,
    maintenances: publicMaintenances(config, maintenances),
  };
}

export function operatorSnapshot(
  config: RuntimeConfig,
  state: StatusView | null,
  maintenances: Maintenance[],
): Snapshot {
  const monitors = toAdminMonitors(config);
  const monitorIds = new Set(monitors.map((monitor) => monitor.id));
  return {
    monitors,
    groups: groupsOf(config, monitorIds),
    state: state && viewOf(state, monitorIds, true),
    maintenances,
  };
}

/**
 * A signed-in member's page. Members who see everything also see the jobs'
 * failure messages; an audience sees its groups the way visitors see the rest.
 */
export function memberSnapshot(
  config: RuntimeConfig,
  state: StatusView | null,
  maintenances: Maintenance[],
  principal: Extract<Principal, { role: 'member' }>,
): Snapshot {
  const monitorIds = visibleMonitorIds(config, principal);
  return {
    monitors: toAdminMonitors(config).filter((monitor) => monitorIds.has(monitor.id)),
    groups: groupsOf(config, monitorIds),
    state: state && viewOf(state, monitorIds, principal.groups === 'all'),
    maintenances: maintenancesFor(maintenances, monitorIds),
  };
}

/** Whether someone may read a monitor's latency: it is visible to them and has a chart. */
export function canReadLatency(
  config: RuntimeConfig,
  monitorId: string,
  principal: Principal | null,
): boolean {
  const monitor = config.monitors.find((candidate) => candidate.id === monitorId);
  return (
    monitor !== undefined &&
    monitor.method !== 'HEARTBEAT' &&
    visibleMonitorIds(config, principal).has(monitorId)
  );
}

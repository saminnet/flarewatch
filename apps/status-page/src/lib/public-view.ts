import {
  isPublicMonitor,
  type Maintenance,
  type Monitor,
  type MonitorView,
  type PageConfigGroup,
  type RuntimeConfig,
  type StatusView,
} from '@flarewatch/shared';

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
 * Maintenance records for public surfaces: ids of private monitors are
 * stripped, and a scoped record left without any public monitor is dropped.
 */
export function publicMaintenances(
  config: RuntimeConfig,
  maintenances: Maintenance[],
): Maintenance[] {
  const publicIds = new Set(config.monitors.filter(isPublicMonitor).map((monitor) => monitor.id));
  const result: Maintenance[] = [];

  for (const maintenance of maintenances) {
    if (!maintenance.monitors?.length) {
      result.push(maintenance);
      continue;
    }
    const monitors = maintenance.monitors.filter((id) => publicIds.has(id));
    if (monitors.length > 0) result.push({ ...maintenance, monitors });
  }

  return result;
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
 * Who may read a monitor's latency: nobody when it has no chart, the operator
 * for a private monitor or a private-only page, anyone otherwise.
 */
export function latencyAccess(
  config: RuntimeConfig,
  monitorId: string,
  privateOnly: boolean,
): 'none' | 'operator' | 'anyone' {
  const monitor = config.monitors.find((candidate) => candidate.id === monitorId);
  if (!monitor || monitor.method === 'HEARTBEAT') return 'none';
  return privateOnly || !isPublicMonitor(monitor) ? 'operator' : 'anyone';
}

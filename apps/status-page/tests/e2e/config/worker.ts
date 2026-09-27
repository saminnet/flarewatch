import type { HeartbeatMonitor, MonitorTarget, WorkerConfig } from '@flarewatch/shared';
import { workerConfig as demoConfig } from '../../../../../packages/config/src/worker.ts';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const privateMonitor: MonitorTarget = {
  id: 'demo_private_internal',
  name: 'Internal Billing API',
  method: 'GET',
  target: 'https://internal.example.com/health',
  link: false,
  private: true,
};

const heartbeat = (
  id: string,
  name: string,
  periodSeconds: number,
  graceSeconds: number,
  options: { private?: boolean } = {},
): HeartbeatMonitor => ({ id, name, method: 'HEARTBEAT', periodSeconds, graceSeconds, ...options });

export const heartbeatMonitors: HeartbeatMonitor[] = [
  heartbeat('demo_nightly_backup', 'Nightly Backup', DAY, 30 * MINUTE),
  heartbeat('demo_hourly_report', 'Hourly Report', HOUR, 5 * MINUTE),
  heartbeat('demo_weekly_prune', 'Weekly Prune', 7 * DAY, HOUR),
  heartbeat('demo_index_rebuild', 'Index Rebuild', HOUR, 10 * MINUTE),
  heartbeat('demo_log_shipper', 'Log Shipper', HOUR, 5 * MINUTE),
  heartbeat('demo_nightly_compactor', 'Nightly Compactor', DAY, 30 * MINUTE),
  heartbeat('demo_private_backup', 'Internal Vault Backup', DAY, 30 * MINUTE, { private: true }),
];

export const workerConfig: WorkerConfig = {
  ...demoConfig,
  monitors: [...demoConfig.monitors, privateMonitor, ...heartbeatMonitors],
};

import type { HeartbeatMonitor, MonitorTarget } from '../../src/types';

export function createMonitor(overrides: Partial<MonitorTarget> = {}): MonitorTarget {
  return {
    id: 'test-monitor',
    name: 'Test Monitor',
    method: 'GET',
    target: 'https://example.com',
    ...overrides,
  };
}

export function createHeartbeat(overrides: Partial<HeartbeatMonitor> = {}): HeartbeatMonitor {
  return {
    id: 'backup',
    name: 'Nightly backup',
    method: 'HEARTBEAT',
    periodSeconds: 3600,
    graceSeconds: 60,
    ...overrides,
  };
}

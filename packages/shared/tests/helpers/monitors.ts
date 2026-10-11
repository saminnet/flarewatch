import type { HeartbeatMonitor, MonitorTarget } from '../../src/types';

/** A valid HTTP monitor; a test overrides the fields it is about. */
export function createMonitor(overrides: Partial<MonitorTarget> = {}): MonitorTarget {
  return {
    id: 'test-monitor',
    name: 'Test Monitor',
    method: 'GET',
    target: 'https://example.com',
    ...overrides,
  };
}

/** A valid heartbeat job; a test overrides the fields it is about. */
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
